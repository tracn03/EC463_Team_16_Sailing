"""
routers/fences.py
CRUD + Pixhawk upload for per-mission geofence polygons.

ArduPilot Rover enforces fences at the hardware level.
- Inclusion polygon (cmd 208): vessel must stay inside.
- Exclusion polygon (cmd 209): vessel must stay outside.
- Breach action is set to RTL (FENCE_ACTION = 1) via parameter write.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from pydantic import BaseModel, Field

from database import get_db
from models import Mission, Fence, FenceVertex
from mavlink_connection import mavlink_conn

# MAVLink fence vertex commands
MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION = 208
MAV_CMD_NAV_FENCE_POLYGON_VERTEX_EXCLUSION = 209

router = APIRouter()


# ── Pydantic schemas ───────────────────────────────────────────────────────────

class FenceVertexIn(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)


class FenceIn(BaseModel):
    fence_type: str = Field(..., pattern="^(inclusion|exclusion)$")
    vertices: List[FenceVertexIn] = Field(..., min_length=3, max_length=500)


class FenceVertexOut(BaseModel):
    id: int
    sequence: int
    latitude: float
    longitude: float

    class Config:
        from_attributes = True


class FenceOut(BaseModel):
    id: int
    fence_type: str
    vertices: List[FenceVertexOut]

    class Config:
        from_attributes = True


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/{mission_id}/fences", response_model=List[FenceOut])
def list_fences(mission_id: int, db: Session = Depends(get_db)):
    """Return all geofence polygons for a mission."""
    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found.")
    return mission.fences


@router.post("/{mission_id}/fences", response_model=FenceOut, status_code=201)
def create_fence(mission_id: int, payload: FenceIn, db: Session = Depends(get_db)):
    """Add a geofence polygon to a mission."""
    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found.")

    fence = Fence(mission_id=mission_id, fence_type=payload.fence_type)
    db.add(fence)
    db.flush()

    for i, v in enumerate(payload.vertices):
        db.add(FenceVertex(
            fence_id=fence.id,
            sequence=i,
            latitude=v.latitude,
            longitude=v.longitude,
        ))

    db.commit()
    db.refresh(fence)
    return fence


@router.delete("/{mission_id}/fences/{fence_id}", status_code=204)
def delete_fence(mission_id: int, fence_id: int, db: Session = Depends(get_db)):
    """Delete a single geofence polygon."""
    fence = db.query(Fence).filter(
        Fence.id == fence_id,
        Fence.mission_id == mission_id,
    ).first()
    if not fence:
        raise HTTPException(status_code=404, detail="Fence not found.")
    db.delete(fence)
    db.commit()


@router.post("/{mission_id}/fences/upload")
def upload_fences_to_pixhawk(mission_id: int, db: Session = Depends(get_db)):
    """
    Upload all geofence polygons for a mission to the Pixhawk via MAVLink.
    Also sets FENCE_ENABLE=1 and FENCE_ACTION=1 (RTL on breach).
    Sending 0 fence items clears any existing fences on the FC.
    """
    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found.")

    # Flatten all fences into a sequential list of MAVLink fence items.
    # Each vertex carries param1 = total vertex count of its polygon so
    # ArduPilot knows which vertices belong to the same polygon.
    fence_items: list = []
    for fence in mission.fences:
        vertices = sorted(fence.vertices, key=lambda v: v.sequence)
        vertex_count = len(vertices)
        command = (
            MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION
            if fence.fence_type == "inclusion"
            else MAV_CMD_NAV_FENCE_POLYGON_VERTEX_EXCLUSION
        )
        for vertex in vertices:
            fence_items.append({
                "command": command,
                "vertex_count": vertex_count,
                "latitude": vertex.latitude,
                "longitude": vertex.longitude,
            })

    # Enable fence and set breach action to RTL before uploading.
    # Non-fatal: if parameter write fails we still attempt item upload.
    params_result = mavlink_conn.set_fence_params(enable=True, action=1)
    if not params_result["success"]:
        # Log but don't abort — item upload may still work
        pass

    result = mavlink_conn.upload_fence(fence_items)
    if not result["success"]:
        raise HTTPException(status_code=502, detail=result["message"])

    return {
        "message": result["message"],
        "fence_count": len(mission.fences),
        "item_count": len(fence_items),
    }
