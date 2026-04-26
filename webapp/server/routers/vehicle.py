"""
routers/vehicle.py
Endpoints for arming/disarming the vessel and changing its flight mode.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from mavlink_connection import mavlink_conn, ROVER_MODES

router = APIRouter()


class ModeRequest(BaseModel):
    mode: str  # "MANUAL" | "HOLD" | "AUTO"


class BatteryFailsafeParams(BaseModel):
    low_volt: float = Field(..., ge=0, description="Low voltage threshold in volts (0 = disabled)")
    crt_volt: float = Field(..., ge=0, description="Critical voltage threshold in volts (0 = disabled)")
    low_act: int   = Field(..., ge=0, le=5, description="Low failsafe action (0=Warn,1=RTL,2=Hold,3=SRTL→RTL,4=SRTL→Hold,5=Disarm)")
    crt_act: int   = Field(..., ge=0, le=5, description="Critical failsafe action")


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


@router.get("/battery-failsafe")
def get_battery_failsafe():
    """Read current battery failsafe parameters from the Pixhawk."""
    results = {}
    for param in ("BATT_LOW_VOLT", "BATT_CRT_VOLT", "BATT_FS_LOW_ACT", "BATT_FS_CRT_ACT"):
        r = mavlink_conn.get_param(param)
        results[param] = r["value"] if r["success"] else None
    return results


@router.post("/battery-failsafe")
def set_battery_failsafe(req: BatteryFailsafeParams):
    """Write battery failsafe parameters to the Pixhawk."""
    result = mavlink_conn.set_battery_failsafe_params(
        low_volt=req.low_volt,
        crt_volt=req.crt_volt,
        low_act=req.low_act,
        crt_act=req.crt_act,
    )
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
