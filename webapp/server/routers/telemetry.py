"""
routers/telemetry.py
Exposes live wind telemetry via:
  GET  /api/telemetry/status  — latest snapshot (HTTP)
  WS   /api/telemetry/ws      — real-time stream at 4 Hz
"""

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from mavlink_connection import mavlink_conn

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/status")
def telemetry_status():
    """Return the latest telemetry snapshot."""
    return mavlink_conn.get_data()


@router.websocket("/ws")
async def telemetry_websocket(websocket: WebSocket):
    """Stream telemetry to the frontend at 4 Hz."""
    await websocket.accept()
    logger.info("WebSocket client connected.")
    try:
        while True:
            data = mavlink_conn.get_data()
            await websocket.send_text(json.dumps(data))
            await asyncio.sleep(0.25)  # 4 Hz
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected.")
    except Exception as exc:
        logger.warning("WebSocket error: %s", exc)
