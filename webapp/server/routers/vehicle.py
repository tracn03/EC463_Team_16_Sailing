"""
routers/vehicle.py
Endpoints for arming/disarming the vessel and changing its flight mode.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from mavlink_connection import mavlink_conn, ROVER_MODES

router = APIRouter()


class ModeRequest(BaseModel):
    mode: str  # "MANUAL" | "HOLD" | "AUTO"


def _raise_if_failed(result: dict):
    if not result["success"]:
        raise HTTPException(status_code=500, detail=result["message"])


@router.post("/arm")
def arm_vehicle():
    """Arm the vehicle (standard — respects pre-arm checks)."""
    result = mavlink_conn.arm(do_arm=True, force=False)
    _raise_if_failed(result)
    return result


@router.post("/arm/force")
def force_arm_vehicle():
    """Arm the vehicle, bypassing pre-arm checks."""
    result = mavlink_conn.arm(do_arm=True, force=True)
    _raise_if_failed(result)
    return result


@router.post("/disarm")
def disarm_vehicle():
    """Disarm the vehicle."""
    result = mavlink_conn.arm(do_arm=False)
    _raise_if_failed(result)
    return result


@router.post("/mode")
def set_mode(req: ModeRequest):
    """Set the flight mode. Accepted values: MANUAL, HOLD, AUTO."""
    if req.mode not in ROVER_MODES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown mode '{req.mode}'. Valid: {list(ROVER_MODES)}",
        )
    result = mavlink_conn.set_mode(req.mode)
    _raise_if_failed(result)
    return result
