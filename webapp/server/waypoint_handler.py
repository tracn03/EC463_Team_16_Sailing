"""
Each line after the header:
  INDEX  CURRENT  FRAME  COMMAND  PARAM1  PARAM2  PARAM3  PARAM4  LAT  LON  ALT  AUTOCONTINUE

Index 0 is always the home position (MAV_CMD_NAV_WAYPOINT, frame=0, current=1).
Subsequent waypoints use MAV_FRAME_GLOBAL_RELATIVE_ALT (frame=3).
"""

from typing import List
from models import Waypoint


def generate_waypoints_file(waypoints: List[Waypoint]) -> str:
    lines = ["QGC WPL 110"]

    for i, wp in enumerate(waypoints):
        is_home = i == 0
        current = 1 if is_home else 0
        frame = 0 if is_home else wp.frame  # Home always uses absolute frame

        line = "\t".join([
            str(i),                         # INDEX
            str(current),                   # CURRENT (1 = home/active)
            str(frame),                     # COORD_FRAME
            str(wp.command),                # COMMAND (16 = NAV_WAYPOINT)
            f"{wp.param1:.6f}",             # PARAM1 hold time
            f"{wp.param2:.6f}",             # PARAM2 acceptance radius
            f"{wp.param3:.6f}",             # PARAM3 pass-through
            f"{wp.param4:.6f}",             # PARAM4 yaw
            f"{wp.latitude:.8f}",           # LATITUDE
            f"{wp.longitude:.8f}",          # LONGITUDE
            f"{wp.altitude:.6f}",           # ALTITUDE
            str(wp.autocontinue),           # AUTOCONTINUE
        ])
        lines.append(line)

    return "\n".join(lines) + "\n"


def generate_waypoints_file_from_dicts(waypoints: List[dict]) -> str:
    """
    generate the file directly from a list of dicts
    without needing ORM objects.
    """
    lines = ["QGC WPL 110"]

    for i, wp in enumerate(waypoints):
        is_home = i == 0
        frame = 0 if is_home else wp.get("frame", 3)

        line = "\t".join([
            str(i),
            "1" if is_home else "0",
            str(frame),
            str(wp.get("command", 16)),
            f"{wp.get('param1', 0.0):.6f}",
            f"{wp.get('param2', 2.0):.6f}",
            f"{wp.get('param3', 0.0):.6f}",
            f"{wp.get('param4', 0.0):.6f}",
            f"{wp['latitude']:.8f}",
            f"{wp['longitude']:.8f}",
            f"{wp.get('altitude', 0.0):.6f}",
            str(wp.get("autocontinue", 1)),
        ])
        lines.append(line)

    return "\n".join(lines) + "\n"