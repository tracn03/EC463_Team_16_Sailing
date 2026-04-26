/**
 * missionApi.ts
 * Type-safe client for the BO-AT Mission Planner FastAPI backend.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";


// Types mirror the Pydantic schemas in the backend


export interface WaypointIn {
  latitude: number;
  longitude: number;
  altitude?: number;
  command?: number;    // MAV_CMD_NAV_WAYPOINT = 16
  frame?: number;      // MAV_FRAME_GLOBAL_RELATIVE_ALT = 3
  param1?: number;
  param2?: number;
  param3?: number;
  param4?: number;
  autocontinue?: number;
}

export interface WaypointOut extends Required<WaypointIn> {
  id: number;
  sequence: number;
}

export interface MissionCreate {
  name: string;
  description?: string;
  waypoints: WaypointIn[];
}

export interface MissionOut {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  waypoints: WaypointOut[];
}

export interface MissionSummary {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  waypoint_count: number;
}



async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail ?? `API error ${res.status}`);
  }

  // 204 No Content responses have no body
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

/** Save a new mission with waypoints. Returns the persisted mission. */
export async function saveMission(payload: MissionCreate): Promise<MissionOut> {
  return apiFetch<MissionOut>("/missions/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Fetch all missions (summary list, no waypoint detail). */
export async function listMissions(): Promise<MissionSummary[]> {
  return apiFetch<MissionSummary[]>("/missions/");
}

/** Fetch a single mission with full waypoint detail. */
export async function getMission(id: number): Promise<MissionOut> {
  return apiFetch<MissionOut>(`/missions/${id}`);
}

/** Delete a mission by ID. */
export async function deleteMission(id: number): Promise<void> {
  return apiFetch<void>(`/missions/${id}`, { method: "DELETE" });
}

export interface UploadResult {
  message: string;
  waypoint_count: number;
}

/** Upload a saved mission's waypoints to the Pixhawk over SiK radio. */
export async function uploadMissionToPixhawk(id: number): Promise<UploadResult> {
  return apiFetch<UploadResult>(`/missions/${id}/upload`, { method: "POST" });
}

export type VehicleMode = "MANUAL" | "HOLD" | "AUTO";

/** Arm the vehicle (respects pre-arm checks). */
export async function armVehicle(): Promise<{ message: string }> {
  return apiFetch("/vehicle/arm", { method: "POST" });
}

/** Arm the vehicle, bypassing pre-arm checks. */
export async function forceArmVehicle(): Promise<{ message: string }> {
  return apiFetch("/vehicle/arm/force", { method: "POST" });
}

/** Disarm the vehicle. */
export async function disarmVehicle(): Promise<{ message: string }> {
  return apiFetch("/vehicle/disarm", { method: "POST" });
}

/** Set the flight mode (MANUAL, HOLD, or AUTO). */
export async function setVehicleMode(mode: VehicleMode): Promise<{ message: string }> {
  return apiFetch("/vehicle/mode", {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

// ── Battery failsafe types & endpoints ──────────────────────────────────────

export interface BatteryFailsafeParams {
  low_volt: number;   // BATT_LOW_VOLT  (volts; 0 = disabled)
  crt_volt: number;   // BATT_CRT_VOLT  (volts; 0 = disabled)
  low_act: number;    // BATT_FS_LOW_ACT (0=Warn,1=RTL,2=Hold,3=SRTL→RTL,4=SRTL→Hold,5=Disarm)
  crt_act: number;    // BATT_FS_CRT_ACT (same enum)
}

/** Read current battery failsafe parameters from the Pixhawk. Any null value means the param read timed out. */
export async function getBatteryFailsafe(): Promise<{ BATT_LOW_VOLT: number | null; BATT_CRT_VOLT: number | null; BATT_FS_LOW_ACT: number | null; BATT_FS_CRT_ACT: number | null }> {
  return apiFetch('/vehicle/battery-failsafe');
}

/** Write battery failsafe parameters to the Pixhawk. */
export async function setBatteryFailsafe(params: BatteryFailsafeParams): Promise<{ message: string }> {
  return apiFetch('/vehicle/battery-failsafe', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ── Geofence types & endpoints ───────────────────────────────────────────────

export type FenceType = 'inclusion' | 'exclusion';

export interface FenceVertexIn {
  latitude: number;
  longitude: number;
}

export interface FenceIn {
  fence_type: FenceType;
  vertices: FenceVertexIn[];
}

export interface FenceVertexOut {
  id: number;
  sequence: number;
  latitude: number;
  longitude: number;
}

export interface FenceOut {
  id: number;
  fence_type: FenceType;
  vertices: FenceVertexOut[];
}

export interface FenceUploadResult {
  message: string;
  fence_count: number;
  item_count: number;
}

/** List all geofences for a saved mission. */
export async function listFences(missionId: number): Promise<FenceOut[]> {
  return apiFetch<FenceOut[]>(`/missions/${missionId}/fences`);
}

/** Save a new geofence polygon for a mission. */
export async function createFence(missionId: number, payload: FenceIn): Promise<FenceOut> {
  return apiFetch<FenceOut>(`/missions/${missionId}/fences`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Delete a geofence polygon. */
export async function deleteFenceFromMission(missionId: number, fenceId: number): Promise<void> {
  return apiFetch<void>(`/missions/${missionId}/fences/${fenceId}`, { method: 'DELETE' });
}

/** Upload all geofences for a mission to the Pixhawk. Sets FENCE_ENABLE + FENCE_ACTION=RTL. */
export async function uploadFencesToPixhawk(missionId: number): Promise<FenceUploadResult> {
  return apiFetch<FenceUploadResult>(`/missions/${missionId}/fences/upload`, { method: 'POST' });
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Download a mission as a .waypoints file compatible with Mission Planner.
 * Triggers a browser file download.
 */
export async function exportMissionFile(id: number, filename?: string): Promise<void> {
  const res = await fetch(`${API_BASE}/missions/${id}/export`);
  if (!res.ok) throw new Error(`Export failed: ${res.statusText}`);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? `mission_${id}.waypoints`;
  a.click();
  URL.revokeObjectURL(url);
}