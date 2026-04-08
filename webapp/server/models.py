from sqlalchemy import Column, Integer, Float, String, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base


class Mission(Base):
    """
    A named mission containing an ordered list of waypoints.
    Later this will also link to telemetry/metrics collected during the run.
    """
    __tablename__ = "missions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    waypoints = relationship(
        "Waypoint",
        back_populates="mission",
        cascade="all, delete-orphan",
        order_by="Waypoint.sequence",
    )

    def __repr__(self):
        return f"<Mission id={self.id} name='{self.name}'>"


class Waypoint(Base):
    __tablename__ = "waypoints"

    id = Column(Integer, primary_key=True, index=True)
    mission_id = Column(Integer, ForeignKey("missions.id"), nullable=False)

    sequence = Column(Integer, nullable=False)   # Order in the mission (0-indexed)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    altitude = Column(Float, default=0.0) 

    # MAVLink fields
    command = Column(Integer, default=16)        # MAV_CMD_NAV_WAYPOINT = 16
    frame = Column(Integer, default=3)           # MAV_FRAME_GLOBAL_RELATIVE_ALT = 3
    param1 = Column(Float, default=0.0)          # Hold time (s)
    param2 = Column(Float, default=2.0)          # Acceptance radius (m)
    param3 = Column(Float, default=0.0)          # Pass-through radius (m)
    param4 = Column(Float, default=0.0)          # Yaw angle (NaN = unchanged)
    autocontinue = Column(Integer, default=1)    # 1 = auto-advance to next waypoint

    mission = relationship("Mission", back_populates="waypoints")

    def __repr__(self):
        return f"<Waypoint seq={self.sequence} lat={self.latitude} lon={self.longitude}>"