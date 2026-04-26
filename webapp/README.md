# BO-AT Mission Planner

A web-based mission planner for autonomous sailboats. The frontend provides an interactive map for building waypoint missions and geofences; the backend communicates with a Pixhawk autopilot over a SiK telemetry radio using MAVLink.

## Stack

| Service  | Technology                              | Port |
|----------|-----------------------------------------|------|
| Frontend | Next.js 15, React 18, Tailwind, Leaflet | 3000 |
| Backend  | FastAPI, SQLAlchemy, Uvicorn            | 8000 |
| Database | SQLite (`server/boat_missions.db`)      | —    |

---

## Installation

### Prerequisites

| Tool | Minimum Version | Install |
|------|----------------|---------|
| Python | 3.10+ | https://www.python.org/downloads/ |
| Node.js | 18+ | https://nodejs.org/ |
| npm | 9+ | Bundled with Node.js |
| Git | Any | https://git-scm.com/ |
| Docker Desktop (optional) | Any | https://www.docker.com/products/docker-desktop/ |

### 1 — Clone the repository

```bash
git clone https://github.com/tracn03/EC463_Team_16_Sailing.git
cd EC463_Team_16_Sailing/webapp
```

### 2 — Configure the serial port

Edit `server/mavlink_connection.py` and set the correct serial port for your SiK radio:

```python
# macOS — find your port with:  ls /dev/cu.*
SERIAL_PORT = "/dev/cu.usbserial-DN05YS5Z"

# Raspberry Pi
SERIAL_PORT = "/dev/ttyUSB0"   # USB SiK radio
# or
SERIAL_PORT = "/dev/ttyAMA0"   # GPIO UART
```

To list available ports on macOS/Linux:

```bash
ls /dev/cu.*       # macOS
ls /dev/tty*       # Linux
```

### 3 — Configure the frontend API URL

Create `my-app/.env.local` (copy the example below):

```bash
# my-app/.env.local
NEXT_PUBLIC_API_URL=http://localhost:8000/api
NEXT_PUBLIC_WS_URL=ws://localhost:8000/api/telemetry/ws
```

For Raspberry Pi or remote deployments, replace `localhost` with the host's IP address:

```bash
NEXT_PUBLIC_API_URL=http://192.168.1.50:8000/api
NEXT_PUBLIC_WS_URL=ws://192.168.1.50:8000/api/telemetry/ws
```

---

## Launching the App

### Option A — Manual (recommended for development)

**Backend** — open a terminal in the `webapp` folder:

```bash
cd server
python -m venv venv

# macOS / Linux
source venv/bin/activate

# Windows
venv\Scripts\activate

pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000`. You can verify it with:

```bash
curl http://localhost:8000/api/health
# {"status": "ok", "service": "BO-AT Mission Planner API"}
```

**Frontend** — open a second terminal in the `webapp` folder:

```bash
cd my-app
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

---

### Option B — Docker (all platforms)

Requires Docker Desktop to be running.

```bash
# From the webapp/ directory
docker compose up --build
```

Open `http://localhost:3000`.

To stop:

```bash
docker compose down
```

**Raspberry Pi with USB SiK radio attached:**

```bash
docker compose -f docker-compose.yml -f docker-compose.pi.yml up --build
```

Update `docker-compose.pi.yml` so the `devices` path matches your serial port (e.g., `/dev/ttyUSB0`).

> **Note:** The Docker image bakes `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` at build time. If you change the host IP after building, rebuild with `docker compose up --build`.

---

## Using the App

The app has two tabs at the top: **Mission Planner** and **Battery Failsafe**.

---

### Mission Planner Tab

#### Interactive Map

The map is the main workspace. It is centered on Boston by default.

| Action | Result |
|--------|--------|
| Click anywhere on the map | Adds a waypoint at that location |
| Click a waypoint marker | Opens a popup with coordinates and a Remove button |
| Drag the map | Pans the view |
| Scroll / pinch | Zooms in or out |

Waypoints are numbered in order. The first waypoint is marked green (start), the last is marked red (end), and intermediate waypoints are blue. During a running mission, the active waypoint turns orange and completed waypoints turn grey with a checkmark.

The live vessel position appears as a blue circle with a heading arrow. The arrow turns grey when the GPS fix becomes stale (no update for 5+ seconds).

---

#### Location Search

The search box at the top of the right panel lets you fly to any location by name.

1. Type a place name (e.g., "Boston Harbor").
2. Select a result from the dropdown.
3. The map flies to that location at zoom level 14.

---

#### Waypoints List

The **Waypoints** section in the right panel lists all placed waypoints in order.

- **Remove** — removes a single waypoint from the list and the map.
- **+ RTL** — appends a Return to Launch command as the final waypoint. The boat will return to the first waypoint after completing the mission.

Waypoints cannot be reordered; remove and re-add them to change the order.

---

#### Geofences

Geofences constrain where the vessel can go. Two types are supported:

| Type | Meaning | Visual |
|------|---------|--------|
| Inclusion Zone | Vessel must stay **inside** this polygon | Solid green border, light green fill |
| Exclusion Zone | Vessel must stay **outside** this polygon | Dashed red border, light red fill |

**Drawing a fence:**

1. Click **+ Inclusion Zone** or **+ Exclusion Zone** to enter drawing mode.
2. Click on the map to place each vertex. A dashed preview line shows the polygon being built.
3. You need at least 3 vertices to finish.
4. Click **Finish** to close and save the fence, or **Cancel** to discard it.

**Deleting a fence:** Click the trash icon next to a fence in the Geofences list.

Fences are uploaded to the Pixhawk automatically when you click **Start Mission**. If the fence upload fails (the mission still starts), an amber warning is shown.

---

#### Mission Control

| Control | Description |
|---------|-------------|
| **Mission name** | Name your mission before saving |
| **Save** | Saves the mission and all waypoints to the local database |
| **Export** | Downloads a `.waypoints` file compatible with Mission Planner and QGroundControl |
| **Start Mission** | Saves the mission, uploads waypoints and fences to the Pixhawk, and sets the vehicle to AUTO mode |
| **Re-upload to Pixhawk** | Resends the current waypoints to the Pixhawk without resetting mission state. Visible only while a mission is running |
| **Reset** | Clears all waypoints, fences, and mission state from the UI. Does not delete saved missions from the database |

The mission status badge shows **idle**, **running**, or **completed**.

**To start a mission:**
1. Place waypoints on the map.
2. Optionally draw geofence zones.
3. Type a mission name and click **Save**.
4. Connect the SiK radio (the telemetry panel must show "connected").
5. Click **Start Mission**.

---

#### Vehicle Control

All buttons in this section are disabled when the SiK radio is not connected.

| Control | Description |
|---------|-------------|
| **Arm** | Arms the vehicle. Respects all pre-arm safety checks (GPS, compass, etc.) |
| **Force Arm** | Arms the vehicle, bypassing pre-arm safety checks. Use with caution |
| **Disarm** | Disarms the vehicle |
| **MANUAL** | Sets the Pixhawk to Manual mode — full RC input control |
| **HOLD** | Sets the Pixhawk to Hold mode — vehicle holds its current position |
| **AUTO** | Sets the Pixhawk to Auto mode — vehicle executes the uploaded mission |

When you click **Arm**, a confirmation dialog appears with an 8-second auto-dismiss. Check **Don't ask again** to skip the dialog in future sessions (preference is stored in browser localStorage).

The panel also shows live status badges: **Armed / Disarmed** and the current flight mode.

---

#### Telemetry Panel

Live telemetry streams at 4 Hz over WebSocket when the SiK radio is connected. If the connection drops, the frontend automatically attempts to reconnect every 3 seconds.

| Field | Description |
|-------|-------------|
| **Battery** | Charge percentage, voltage (V), and current draw (A). Color-coded green/amber/red |
| **Wind Speed** | Apparent wind speed in knots |
| **Wind Direction** | Compass rose visual + bearing in degrees |
| **Boat Speed** | Speed over ground in knots |
| **GPS** | Latitude, longitude, heading, and fix quality indicator |
| **Roll / Pitch / Yaw** | Live orientation with an attitude indicator (artificial horizon) showing the physical tilt |

**Alert banners** appear at the top of the page when triggered:

| Banner | Trigger |
|--------|---------|
| Capsize Detected | Roll angle exceeds 80° for more than 2 seconds |
| Battery Critical | Voltage drops below the critical threshold set in Battery Failsafe |
| Battery Low | Voltage drops below the low threshold set in Battery Failsafe |

---

### Battery Failsafe Tab

Configures the two-stage battery failsafe on the Pixhawk. These parameters are written directly to the flight controller over MAVLink.

**Stage 1 — Low Battery:**

| Field | Description |
|-------|-------------|
| Voltage threshold | Voltage (V) at which Stage 1 triggers. Set to 0 to disable |
| Action | What the vehicle does when Stage 1 triggers |

**Stage 2 — Critical Battery:**

| Field | Description |
|-------|-------------|
| Voltage threshold | Must be **strictly lower** than the Stage 1 threshold. Set to 0 to disable |
| Action | What the vehicle does when Stage 2 triggers |

Available actions for both stages:

| Value | Action |
|-------|--------|
| 0 | Warn only (no autonomous action) |
| 1 | Return to Launch (RTL) |
| 2 | Hold position |
| 3 | SmartRTL, fall back to RTL |
| 4 | SmartRTL, fall back to Hold |
| 5 | Disarm immediately |

Click **Apply to Pixhawk** to write both thresholds and actions to the flight controller. The current values are read from the Pixhawk each time you open the tab.

---

## API Reference

All endpoints are prefixed with `/api`.

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Returns `{"status": "ok"}` |

### Missions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/missions` | List all saved missions |
| POST | `/missions` | Create a new mission |
| GET | `/missions/{id}` | Get mission with full waypoint detail |
| DELETE | `/missions/{id}` | Delete a mission |
| POST | `/missions/{id}/upload` | Upload mission waypoints to Pixhawk |
| GET | `/missions/{id}/export` | Download `.waypoints` file |

### Geofences

| Method | Path | Description |
|--------|------|-------------|
| GET | `/missions/{id}/fences` | List all fences for a mission |
| POST | `/missions/{id}/fences` | Create a new geofence |
| DELETE | `/missions/{id}/fences/{fence_id}` | Delete a geofence |
| POST | `/missions/{id}/fences/upload` | Upload fences to Pixhawk |

### Vehicle Control

| Method | Path | Description |
|--------|------|-------------|
| POST | `/vehicle/arm` | Arm vehicle |
| POST | `/vehicle/arm/force` | Force arm vehicle |
| POST | `/vehicle/disarm` | Disarm vehicle |
| POST | `/vehicle/mode` | Set flight mode (`MANUAL`, `HOLD`, `AUTO`) |
| GET | `/vehicle/battery-failsafe` | Read battery failsafe params from Pixhawk |
| POST | `/vehicle/battery-failsafe` | Write battery failsafe params to Pixhawk |

### Telemetry

| Method | Path | Description |
|--------|------|-------------|
| GET | `/telemetry/status` | Latest telemetry snapshot (HTTP) |
| WebSocket | `/telemetry/ws` | Live 4 Hz telemetry stream |

---

## Troubleshooting

**"No heartbeat received" in backend logs**
The Pixhawk is not sending MAVLink heartbeats. Check: SiK radio power, USB cable, baud rate (must be 57600), and that ArduPilot firmware is running.

**"Not connected to Pixhawk" errors**
The serial port is wrong or the backend cannot open it. On Linux, add your user to the `dialout` group: `sudo usermod -aG dialout $USER` and re-login.

**Frontend shows "Connect the radio to apply changes"**
The WebSocket telemetry connection is not established. Verify the backend is running, the SiK radio is plugged in, and `NEXT_PUBLIC_WS_URL` points to the correct host.

**Mission upload rejected by Pixhawk**
The Pixhawk returned a non-zero MISSION_ACK code. Common causes: too many waypoints for the firmware's storage limit, invalid coordinates, or the vehicle is currently armed.

**Fence upload warning (amber banner) after Start Mission**
The fence uploaded to the database and the mission started, but writing the fence parameters to the Pixhawk failed. The vehicle will still execute the waypoint mission but geofencing may not be active. Check backend logs for the specific parameter error.

**Docker — database lost after restart**
The SQLite file is not persisted across container restarts by default. Add a volume to `docker-compose.yml`:
```yaml
services:
  server:
    volumes:
      - ./data:/app/data
```
And update `mavlink_connection.py` to write the DB to `/app/data/boat_missions.db`.
