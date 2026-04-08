# BO-AT Mission Planner

A web-based mission planner for BO-AT. The frontend provides an interactive map for building waypoint missions, and the backend communicates with a Pixhawk autopilot over a SiK telemetry radio using MAVLink.

## Stack

| Service  | Technology                              | Port |
|----------|-----------------------------------------|------|
| Frontend | Next.js 15, React 18, Tailwind, Leaflet | 3000 |
| Backend  | FastAPI, SQLAlchemy, Uvicorn            | 8000 |
| Database | SQLite (`server/boat_missions.db`)      | —    |

---

## Launching the App

### Option 1 — Manual

**Backend:**

```bash
cd server
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

**Frontend** (in a separate terminal):

```bash
cd my-app
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

### Option 2 — Docker (WIP)

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
docker compose up --build
```

Then open [http://localhost:3000](http://localhost:3000).

**On a Raspberry Pi** (with USB SiK radio attached):

```bash
docker compose -f docker-compose.yml -f docker-compose.pi.yml up --build
```

---

## Configuration

**Serial port** — edit `server/mavlink_connection.py`:
- macOS: `/dev/cu.usbserial-DN05YS5Z` (default)
- Raspberry Pi: `/dev/ttyUSB0` or `/dev/ttyAMA0`

Also update the device path in `docker-compose.pi.yml` to match.

**Frontend API URL** — set in `my-app/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:8000/api
```

---

## Using the App

### Planning a Mission

1. **Click on the map** to place waypoints. Each click adds a numbered waypoint in order.
2. The first waypoint is the **start point** (green), the last is the **end point** (red).
3. Click a waypoint marker on the map to open a popup showing its coordinates and a **Remove** button.
4. Waypoints also appear in the **Waypoints list** in the right panel, where they can be removed individually.

### Saving and Exporting

- Type a name in the **Mission name** field, then click **Save** to store the mission in the database.
- Once saved, click **Export** to download a `.waypoints` file compatible with Mission Planner / QGroundControl.

### Uploading to the Pixhawk

The SiK radio must be connected and the backend must show **SiK radio connected** in the telemetry panel.

1. Click **Start Mission** — this saves the mission and uploads the waypoints to the Pixhawk over MAVLink.
2. While the mission is running, click **Re-upload to Pixhawk** to resend the current waypoints without resetting mission state.

### Vehicle Control

Located in the right panel under **Vehicle Control**. All controls are disabled when the radio is disconnected.

| Control | Description |
|---------|-------------|
| **Arm** | Arms the vehicle (respects pre-arm safety checks) |
| **Force Arm** | Arms the vehicle, bypassing pre-arm checks |
| **Disarm** | Disarms the vehicle |
| **MANUAL / HOLD / AUTO** | Sets the flight mode on the Pixhawk |

Arming shows a confirmation dialog by default. Check **Don't ask again** to skip it in future sessions.

### Telemetry Panel

Live data streams at 4 Hz over WebSocket when the radio is connected:

- **Battery** — charge percentage, voltage, and current draw
- **Wind Speed** — in knots
- **Wind Direction** — compass rose + bearing in degrees
- **Speed** — boat speed over ground in knots
- **GPS** — latitude, longitude, heading, and fix status
- **Orientation** — roll, pitch, yaw with an attitude indicator display

A **Capsize Detected** banner appears at the top if the roll angle exceeds 80° for more than 2 seconds.

The live vessel position is shown on the map as a blue circle with a heading arrow. The arrow turns grey when the GPS fix is stale.
