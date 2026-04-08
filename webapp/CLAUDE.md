# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BO-AT is an autonomous RC sailboat mission planner. It consists of a Next.js frontend for interactive map-based waypoint planning and a FastAPI backend that bridges the web UI with a Pixhawk autopilot over a SiK radio telemetry link using the MAVLink protocol.

## Commands

### Frontend (`/my-app`)

```bash
npm run dev          # Start dev server on localhost:3000
npm run build        # Production build
npm run lint         # ESLint
npm test             # Run Jest tests
npm run test:watch   # Watch mode
npm run test:coverage
```

### Backend (`/server`)

```bash
# With virtualenv
source venv/bin/activate
pip install -r requirements.txt
python main.py
# Or directly:
uvicorn main:app --host 0.0.0.0 --port 8000
```

### Docker (full stack)

```bash
# macOS / Docker Desktop
docker compose up --build

# Raspberry Pi (adds USB serial device passthrough)
docker compose -f docker-compose.yml -f docker-compose.pi.yml up --build
```

## Architecture

### Services

| Service | Tech | Port |
|---------|------|------|
| Frontend | Next.js 15, React 18, Tailwind, Leaflet | 3000 |
| Backend | FastAPI, SQLAlchemy, Uvicorn | 8000 |
| Database | SQLite (`server/boat_missions.db`) | — |

### Data Flow

```
Pixhawk + Wind/GPS sensors
  └─ MAVLink over SiK radio (serial)
       └─ server/mavlink_connection.py
            ├─ GET  /api/telemetry/status  (snapshot)
            ├─ WS   /api/telemetry/ws      (4 Hz stream)
            └─ POST /api/missions/{id}/upload  (waypoint upload)

Frontend (Leaflet map)
  ├─ REST /api/missions/*  (CRUD, export)
  └─ WebSocket /api/telemetry/ws  (live telemetry display)
```

### Backend Structure (`/server`)

- `main.py` — FastAPI app, CORS setup, router registration
- `models.py` — SQLAlchemy models: `Mission`, `Waypoint`
- `database.py` — SQLite engine/session
- `mavlink_connection.py` — Serial/MAVLink connection to Pixhawk; reads GPS, wind, mission state
- `waypoint_handler.py` — Generates QGC WPL 110 `.waypoints` files
- `routers/missions.py` — Mission CRUD + upload + export endpoints
- `routers/telemetry.py` — HTTP snapshot + WebSocket streaming

### Frontend Structure (`/my-app`)

- `app/page.tsx` — Single-page mission planner UI (waypoint editing, telemetry panel, wind compass)
- `app/components/MapComponent.tsx` — Leaflet map with clickable waypoint placement
- `lib/missionApi.ts` — Typed REST client; source of truth for API types (mirrors backend Pydantic schemas)

### Telemetry Payload (WebSocket)

```typescript
{
  connected: boolean
  wind_speed_knots: number | null
  wind_direction_deg: number | null
  timestamp: number | null
  gps_lat: number | null
  gps_lon: number | null
  gps_alt_m: number | null
  gps_heading_deg: number | null
  gps_speed_knots: number | null
  gps_fix: boolean
  current_waypoint_seq: number | null
  mission_count: number | null
}
```

## Configuration

**Frontend API URL** (`my-app/.env.local`):
```
NEXT_PUBLIC_API_URL=http://localhost:8000/api
```
This is baked into the Docker image at build time via build args.

**Serial port** (`server/mavlink_connection.py`):
- macOS: `/dev/cu.usbserial-DN05YS5Z` at 57600 baud
- Raspberry Pi: update to `/dev/ttyUSB0` or `/dev/ttyAMA0` and update `docker-compose.pi.yml` device mapping accordingly

## Key Notes

- The `__tests__/` directory exists in `my-app/` but has no test files yet — Jest is configured and ready.
- SQLite database is not yet volume-mounted in docker-compose; data is lost on container rebuild.
- Mission export uses QGC WPL 110 format, compatible with Mission Planner / QGroundControl.
