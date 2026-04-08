"""
mavlink_connection.py
Manages a persistent MAVLink connection over the SiK telemetry radio.
Runs a background thread to read WIND messages from ArduRover and exposes
the latest data thread-safely via get_data().
Also supports uploading mission waypoints to the Pixhawk via the MAVLink
mission upload protocol.
"""

import math
import os
import threading
import time
import logging
from typing import Optional, Dict, Any, List
from pymavlink import mavutil

logger = logging.getLogger(__name__)

SERIAL_PORT = os.environ.get("MAVLINK_SERIAL_PORT", "/dev/cu.usbserial-DN05YS5Z")
BAUD_RATE = 57600
MS_TO_KNOTS = 1.94384
# Wind vane is mounted 90° clockwise from the bow, so subtract to get true bearing
WIND_SENSOR_OFFSET_DEG = 90

# ArduRover custom mode IDs used for mode switching
ROVER_MODES = {"MANUAL": 0, "HOLD": 4, "AUTO": 10}

# Human-readable names for all ArduRover custom modes (for HEARTBEAT parsing)
_ROVER_MODE_NAMES: Dict[int, str] = {
    0: "MANUAL", 1: "ACRO", 3: "STEERING", 4: "HOLD",
    5: "LOITER", 6: "FOLLOW", 10: "AUTO", 11: "RTL",
    12: "SRTL", 15: "GUIDED", 16: "INIT",
}

# ArduRover MAVLink message IDs
MAVLINK_MSG_ID_WIND = 168
MAVLINK_MSG_ID_GLOBAL_POSITION_INT = 33
MAVLINK_MSG_ID_ATTITUDE = 30
MAVLINK_MSG_ID_SYS_STATUS = 1

# GPS fix considered stale after this many seconds without a new message
GPS_STALE_TIMEOUT = 5.0

# Capsize detection parameters
CAPSIZE_ROLL_THRESHOLD_DEG = 80.0   # |roll| above this triggers capsize
CAPSIZE_SUSTAIN_SECS = 2.0          # must stay above threshold for this long


class MAVLinkConnection:
    def __init__(self):
        self._connection: Optional[mavutil.mavfile] = None
        self._thread: Optional[threading.Thread] = None
        self._running = threading.Event()
        self._lock = threading.Lock()
        self._upload_lock = threading.Lock()
        self._upload_paused = threading.Event()
        self._gps_last_update: Optional[float] = None
        self._capsize_start: Optional[float] = None  # time roll first exceeded threshold
        self._data: Dict[str, Any] = {
            "connected": False,
            "wind_speed_knots": None,
            "wind_direction_deg": None,
            "timestamp": None,
            "current_waypoint_seq": None,
            "mission_count": None,
            "gps_lat": None,
            "gps_lon": None,
            "gps_alt_m": None,
            "gps_heading_deg": None,
            "gps_speed_knots": None,
            "roll_deg": None,
            "pitch_deg": None,
            "yaw_deg": None,
            "capsized": False,
            "battery_pct": None,
            "battery_voltage_v": None,
            "battery_current_a": None,
            "armed": False,
            "flight_mode": None,
        }

    def start(self) -> bool:
        """Connect and start the background reader thread."""
        if not self._connect():
            return False
        self._running.set()
        self._thread = threading.Thread(
            target=self._read_loop, daemon=True, name="mavlink-reader"
        )
        self._thread.start()
        return True

    def stop(self):
        """Stop the reader and close the connection."""
        self._running.clear()
        if self._connection:
            try:
                self._connection.close()
            except Exception:
                pass
        with self._lock:
            self._data["connected"] = False

    def get_data(self) -> Dict[str, Any]:
        """Return a snapshot of the latest telemetry (thread-safe)."""
        with self._lock:
            data = dict(self._data)
            last_update = self._gps_last_update
        # gps_fix is derived at read-time so it reflects real staleness
        if last_update is not None:
            data["gps_fix"] = (time.time() - last_update) < GPS_STALE_TIMEOUT
        else:
            data["gps_fix"] = False
        return data

    def _connect(self) -> bool:
        try:
            logger.info("Connecting to %s at %d baud...", SERIAL_PORT, BAUD_RATE)
            self._connection = mavutil.mavlink_connection(
                SERIAL_PORT,
                baud=BAUD_RATE,
                source_system=255,
            )
            logger.info("Waiting for heartbeat (timeout 15 s)...")
            hb = self._connection.wait_heartbeat(timeout=15)
            if hb is None:
                logger.error("No heartbeat received — check radio link and Pixhawk power.")
                return False

            logger.info(
                "Heartbeat from system %d, component %d.",
                self._connection.target_system,
                self._connection.target_component,
            )

            # Request WIND messages at 4 Hz using the targeted MAVLink v2 command
            self._connection.mav.command_long_send(
                self._connection.target_system,
                self._connection.target_component,
                mavutil.mavlink.MAV_CMD_SET_MESSAGE_INTERVAL,
                0,                      # confirmation
                MAVLINK_MSG_ID_WIND,    # message ID
                250_000,                # interval in microseconds (4 Hz)
                0, 0, 0, 0, 0,
            )

            # Also request the EXTRA1 stream as a fallback for older firmwares
            self._connection.mav.request_data_stream_send(
                self._connection.target_system,
                self._connection.target_component,
                mavutil.mavlink.MAV_DATA_STREAM_EXTRA1,
                4,  # 4 Hz
                1,  # start
            )

            # Request GLOBAL_POSITION_INT at 4 Hz for live GPS
            self._connection.mav.command_long_send(
                self._connection.target_system,
                self._connection.target_component,
                mavutil.mavlink.MAV_CMD_SET_MESSAGE_INTERVAL,
                0,
                MAVLINK_MSG_ID_GLOBAL_POSITION_INT,
                250_000,  # interval in microseconds (4 Hz)
                0, 0, 0, 0, 0,
            )

            # Also request the POSITION stream as fallback
            self._connection.mav.request_data_stream_send(
                self._connection.target_system,
                self._connection.target_component,
                mavutil.mavlink.MAV_DATA_STREAM_POSITION,
                4,  # 4 Hz
                1,  # start
            )

            # Request ATTITUDE at 4 Hz for capsize detection
            self._connection.mav.command_long_send(
                self._connection.target_system,
                self._connection.target_component,
                mavutil.mavlink.MAV_CMD_SET_MESSAGE_INTERVAL,
                0,
                MAVLINK_MSG_ID_ATTITUDE,
                250_000,  # interval in microseconds (4 Hz)
                0, 0, 0, 0, 0,
            )

            # Request SYS_STATUS at 2 Hz for battery telemetry
            self._connection.mav.command_long_send(
                self._connection.target_system,
                self._connection.target_component,
                mavutil.mavlink.MAV_CMD_SET_MESSAGE_INTERVAL,
                0,
                MAVLINK_MSG_ID_SYS_STATUS,
                500_000,  # interval in microseconds (2 Hz)
                0, 0, 0, 0, 0,
            )
            # Fallback stream for older firmware
            self._connection.mav.request_data_stream_send(
                self._connection.target_system,
                self._connection.target_component,
                mavutil.mavlink.MAV_DATA_STREAM_EXTENDED_STATUS,
                2,  # 2 Hz
                1,  # start
            )

            with self._lock:
                self._data["connected"] = True
            return True

        except Exception as exc:
            logger.error("Connection failed: %s", exc)
            return False

    def upload_mission(self, waypoints: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Upload mission waypoints to ArduRover via the MAVLink mission protocol.
        Pauses the background read loop during transfer so it doesn't consume
        the MISSION_REQUEST / MISSION_ACK messages we need.

        waypoints: list of dicts with keys latitude, longitude, altitude,
                   command, frame, param1-4, autocontinue (matching DB schema).
        Returns {'success': bool, 'message': str}.
        """
        if not self._connection:
            return {"success": False, "message": "Not connected to Pixhawk"}

        count = len(waypoints)
        if count == 0:
            return {"success": False, "message": "No waypoints to upload"}

        with self._upload_lock:
            # Signal the read loop to yield, then wait briefly for it to do so
            self._upload_paused.set()
            time.sleep(0.15)

            try:
                target_sys = self._connection.target_system
                target_comp = self._connection.target_component

                logger.info("Uploading %d waypoints to system %d...", count, target_sys)
                self._connection.mav.mission_count_send(target_sys, target_comp, count)

                while True:
                    msg = self._connection.recv_match(
                        type=["MISSION_REQUEST", "MISSION_REQUEST_INT", "MISSION_ACK"],
                        blocking=True,
                        timeout=5.0,
                    )
                    if msg is None:
                        return {"success": False, "message": "Timeout waiting for Pixhawk response"}

                    msg_type = msg.get_type()

                    if msg_type == "MISSION_ACK":
                        if msg.type == mavutil.mavlink.MAV_MISSION_ACCEPTED:
                            logger.info("Mission upload accepted by Pixhawk.")
                            with self._lock:
                                self._data["mission_count"] = count
                            return {"success": True, "message": f"Uploaded {count} waypoints successfully"}
                        else:
                            return {"success": False, "message": f"Mission upload rejected by Pixhawk (code {msg.type})"}

                    if msg_type in ("MISSION_REQUEST", "MISSION_REQUEST_INT"):
                        seq = msg.seq
                        if seq >= count:
                            return {
                                "success": False,
                                "message": f"Pixhawk requested seq {seq} but only {count} waypoints exist",
                            }

                        wp = waypoints[seq]
                        # Waypoint 0 is always home — must use absolute frame (MAV_FRAME_GLOBAL = 0)
                        is_home = seq == 0
                        frame = 0 if is_home else int(wp.get("frame", 3))

                        self._connection.mav.mission_item_int_send(
                            target_sys,
                            target_comp,
                            seq,
                            frame,
                            int(wp.get("command", 16)),
                            1 if is_home else 0,        # current (1 = home)
                            int(wp.get("autocontinue", 1)),
                            float(wp.get("param1", 0.0)),
                            float(wp.get("param2", 2.0)),
                            float(wp.get("param3", 0.0)),
                            float(wp.get("param4", 0.0)),
                            int(float(wp["latitude"]) * 1e7),
                            int(float(wp["longitude"]) * 1e7),
                            float(wp.get("altitude", 0.0)),
                            mavutil.mavlink.MAV_MISSION_TYPE_MISSION,
                        )
                        logger.debug("Sent MISSION_ITEM_INT seq=%d", seq)

            except Exception as exc:
                logger.error("Mission upload error: %s", exc)
                return {"success": False, "message": f"Upload error: {exc}"}

            finally:
                self._upload_paused.clear()

    def arm(self, do_arm: bool, force: bool = False) -> Dict[str, Any]:
        """
        Arm or disarm the vehicle.
        force=True bypasses pre-arm checks (ArduPilot magic param2=21196).
        Pauses the read loop while waiting for COMMAND_ACK.
        """
        if not self._connection:
            return {"success": False, "message": "Not connected to Pixhawk"}

        with self._upload_lock:
            self._upload_paused.set()
            time.sleep(0.1)
            try:
                self._connection.mav.command_long_send(
                    self._connection.target_system,
                    self._connection.target_component,
                    mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
                    0,
                    1 if do_arm else 0,
                    21196 if (force and do_arm) else 0,  # ArduPilot force-arm bypass
                    0, 0, 0, 0, 0,
                )
                ack = self._connection.recv_match(
                    type="COMMAND_ACK", blocking=True, timeout=3.0
                )
                if ack and ack.result == mavutil.mavlink.MAV_RESULT_ACCEPTED:
                    label = "Force armed" if force else ("Armed" if do_arm else "Disarmed")
                    return {"success": True, "message": label}
                code = ack.result if ack else "timeout"
                return {
                    "success": False,
                    "message": f"Command {'rejected' if ack else 'timed out'} (code {code})",
                }
            except Exception as exc:
                logger.error("Arm/disarm error: %s", exc)
                return {"success": False, "message": str(exc)}
            finally:
                self._upload_paused.clear()

    def set_mode(self, mode_name: str) -> Dict[str, Any]:
        """
        Set the vehicle flight mode to one of the ROVER_MODES keys.
        Pauses the read loop while waiting for COMMAND_ACK.
        """
        if not self._connection:
            return {"success": False, "message": "Not connected to Pixhawk"}

        custom_mode = ROVER_MODES.get(mode_name)
        if custom_mode is None:
            return {"success": False, "message": f"Unknown mode '{mode_name}'"}

        with self._upload_lock:
            self._upload_paused.set()
            time.sleep(0.1)
            try:
                self._connection.mav.command_long_send(
                    self._connection.target_system,
                    self._connection.target_component,
                    mavutil.mavlink.MAV_CMD_DO_SET_MODE,
                    0,
                    mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
                    custom_mode,
                    0, 0, 0, 0, 0,
                )
                ack = self._connection.recv_match(
                    type="COMMAND_ACK", blocking=True, timeout=3.0
                )
                if ack and ack.result == mavutil.mavlink.MAV_RESULT_ACCEPTED:
                    return {"success": True, "message": f"Mode set to {mode_name}"}
                code = ack.result if ack else "timeout"
                return {
                    "success": False,
                    "message": f"Mode change {'rejected' if ack else 'timed out'} (code {code})",
                }
            except Exception as exc:
                logger.error("Set mode error: %s", exc)
                return {"success": False, "message": str(exc)}
            finally:
                self._upload_paused.clear()

    def _read_loop(self):
        """Background thread: parse incoming MAVLink messages."""
        while self._running.is_set():
            # Yield while a mission upload is in progress
            if self._upload_paused.is_set():
                time.sleep(0.1)
                continue

            if self._connection is None:
                time.sleep(0.5)
                continue
            try:
                msg = self._connection.recv_match(
                    type=["WIND", "HEARTBEAT", "MISSION_CURRENT", "MISSION_ITEM_REACHED",
                          "GLOBAL_POSITION_INT", "ATTITUDE", "SYS_STATUS"],
                    blocking=True,
                    timeout=2.0,
                )
                if msg is None:
                    continue

                msg_type = msg.get_type()

                if msg_type == "WIND":
                    with self._lock:
                        self._data.update(
                            {
                                "connected": True,
                                # speed is m/s from the modified firmware; convert to knots
                                "wind_speed_knots": round(msg.speed * MS_TO_KNOTS, 2),
                                # direction: degrees the wind is coming FROM (0 = N)
                                # subtract mounting offset to correct for sensor orientation
                                "wind_direction_deg": round((msg.direction - WIND_SENSOR_OFFSET_DEG) % 360, 1),
                                "timestamp": time.time(),
                            }
                        )

                elif msg_type == "HEARTBEAT":
                    # Ignore heartbeats from GCS/ourselves; only process the autopilot's
                    if msg.get_srcSystem() != self._connection.target_system:
                        continue
                    with self._lock:
                        self._data["connected"] = True
                        self._data["armed"] = bool(
                            msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED
                        )
                        self._data["flight_mode"] = _ROVER_MODE_NAMES.get(
                            msg.custom_mode, f"MODE_{msg.custom_mode}"
                        )

                elif msg_type == "MISSION_CURRENT":
                    with self._lock:
                        self._data["current_waypoint_seq"] = msg.seq

                elif msg_type == "MISSION_ITEM_REACHED":
                    logger.info("Waypoint seq=%d reached.", msg.seq)

                elif msg_type == "SYS_STATUS":
                    with self._lock:
                        # voltage_battery: mV, UINT16_MAX (65535) = unknown
                        v = msg.voltage_battery
                        # current_battery: 10 mA units, -1 = not measured
                        c = msg.current_battery
                        # battery_remaining: %, -1 = not estimated
                        pct = msg.battery_remaining
                        self._data["battery_voltage_v"] = None if v == 65535 else round(v / 1000.0, 2)
                        self._data["battery_current_a"] = None if c < 0 else round(c / 100.0, 2)
                        self._data["battery_pct"] = None if pct < 0 else int(pct)

                elif msg_type == "ATTITUDE":
                    with self._lock:
                        roll_deg = round(math.degrees(msg.roll), 1)
                        pitch_deg = round(math.degrees(msg.pitch), 1)
                        # yaw: -π..π (0=N, positive=CW) → 0–360° compass bearing
                        yaw_deg = round(math.degrees(msg.yaw) % 360, 1)
                        now = time.time()
                        if abs(roll_deg) >= CAPSIZE_ROLL_THRESHOLD_DEG:
                            if self._capsize_start is None:
                                self._capsize_start = now
                            capsized = (now - self._capsize_start) >= CAPSIZE_SUSTAIN_SECS
                        else:
                            self._capsize_start = None
                            capsized = False
                        self._data["roll_deg"] = roll_deg
                        self._data["pitch_deg"] = pitch_deg
                        self._data["yaw_deg"] = yaw_deg
                        self._data["capsized"] = capsized

                elif msg_type == "GLOBAL_POSITION_INT":
                    lat = msg.lat / 1e7          # degE7 → decimal degrees
                    lon = msg.lon / 1e7
                    # lat=0 / lon=0 means the Pixhawk has no satellite fix yet;
                    # skip the update so we don't place the marker at (0, 0)
                    # and don't falsely advance _gps_last_update.
                    if msg.lat == 0 and msg.lon == 0:
                        continue
                    alt = msg.alt / 1000.0        # mm → metres
                    # vx/vy are in cm/s; derive ground speed in knots
                    speed_ms = math.sqrt(msg.vx ** 2 + msg.vy ** 2) / 100.0
                    speed_knots = round(speed_ms * MS_TO_KNOTS, 2)
                    # hdg: 0–35999 cdeg (0.01 deg resolution); 65535 = unknown
                    heading = None if msg.hdg == 65535 else round(msg.hdg / 100.0, 1)
                    with self._lock:
                        self._data["gps_lat"] = round(lat, 7)
                        self._data["gps_lon"] = round(lon, 7)
                        self._data["gps_alt_m"] = round(alt, 1)
                        self._data["gps_speed_knots"] = speed_knots
                        self._data["gps_heading_deg"] = heading
                        self._gps_last_update = time.time()

            except Exception as exc:
                logger.error("Read error: %s", exc)
                time.sleep(0.5)


# Module-level singleton used by the FastAPI app
mavlink_conn = MAVLinkConnection()
