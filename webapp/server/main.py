import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from database import engine, Base
from mavlink_connection import mavlink_conn
from routers import missions
from routers import telemetry
from routers import vehicle

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

Base.metadata.create_all(bind=engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting MAVLink connection...")
    ok = mavlink_conn.start()
    if ok:
        logger.info("MAVLink connected — telemetry streaming.")
    else:
        logger.warning(
            "MAVLink connection failed. "
            "Telemetry will be unavailable until the radio is connected."
        )
    yield
    logger.info("Shutting down MAVLink connection...")
    mavlink_conn.stop()


app = FastAPI(
    title="BO-AT Mission Planner API",
    description="Backend for the autonomous RC sailboat mission planner",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(missions.router, prefix="/api/missions", tags=["missions"])
app.include_router(telemetry.router, prefix="/api/telemetry", tags=["telemetry"])
app.include_router(vehicle.router,   prefix="/api/vehicle",   tags=["vehicle"])


@app.get("/api/health")
def health_check():
    return JSONResponse({"status": "ok", "service": "BO-AT Mission Planner API"})
