'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Play, Navigation, Battery, Wind, Gauge, Save, Download, Upload, CheckCircle, MapPin } from 'lucide-react';
import { saveMission, exportMissionFile, uploadMissionToPixhawk, armVehicle, forceArmVehicle, disarmVehicle, setVehicleMode, type VehicleMode } from '@/lib/missionApi';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:8000/api/telemetry/ws';

interface TelemetryData {
  connected: boolean;
  wind_speed_knots: number | null;
  wind_direction_deg: number | null;
  timestamp: number | null;
  current_waypoint_seq: number | null;
  mission_count: number | null;
  gps_lat: number | null;
  gps_lon: number | null;
  gps_alt_m: number | null;
  gps_heading_deg: number | null;
  gps_speed_knots: number | null;
  gps_fix: boolean;
  roll_deg: number | null;
  pitch_deg: number | null;
  yaw_deg: number | null;
  capsized: boolean;
  battery_pct: number | null;
  battery_voltage_v: number | null;
  battery_current_a: number | null;
  armed: boolean;
  flight_mode: string | null;
}

/** Converts degrees to 16-point compass label (e.g. 45 → "NE"). */
function compassLabel(deg: number): string {
  const labels = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return labels[Math.round(deg / 22.5) % 16];
}

/** SVG battery indicator showing charge level with colour-coded fill. */
function BatteryIcon({ pct }: { pct: number | null }) {
  const fill = pct ?? 0;
  const color = fill > 50 ? '#16a34a' : fill > 20 ? '#d97706' : '#dc2626';
  // Body: 28×14, nub: 3×6 on the right. Inner fill area is 22×10 starting at x=3, y=2.
  const fillW = Math.round((fill / 100) * 22);
  return (
    <svg viewBox="0 0 34 14" className="w-10 h-5" aria-label={`Battery ${pct ?? '—'}%`}>
      {/* Body outline */}
      <rect x="0.5" y="0.5" width="28" height="13" rx="2.5" ry="2.5"
        fill="none" stroke={pct !== null ? color : '#94a3b8'} strokeWidth="1.5" />
      {/* Terminal nub */}
      <rect x="29.5" y="4" width="3.5" height="6" rx="1"
        fill={pct !== null ? color : '#94a3b8'} />
      {/* Charge fill */}
      {pct !== null && fillW > 0 && (
        <rect x="3" y="3" width={fillW} height="8" rx="1.5"
          fill={color} />
      )}
    </svg>
  );
}

/** SVG arrow indicating wind direction (the direction wind is coming FROM). */
function WindCompass({ deg, className = 'w-12 h-12' }: { deg: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-label={`Wind from ${deg}°`}>
      {/* Outer ring */}
      <circle cx="32" cy="32" r="30" fill="none" stroke="#bfdbfe" strokeWidth="2" />
      {/* Cardinal labels */}
      <text x="32" y="8"  textAnchor="middle" fontSize="7" fill="#60a5fa" fontWeight="bold">N</text>
      <text x="32" y="61" textAnchor="middle" fontSize="7" fill="#60a5fa">S</text>
      <text x="5"  y="35" textAnchor="middle" fontSize="7" fill="#60a5fa">W</text>
      <text x="59" y="35" textAnchor="middle" fontSize="7" fill="#60a5fa">E</text>
      {/* Arrow — rotated to point toward the direction wind comes FROM */}
      <g transform={`rotate(${deg}, 32, 32)`}>
        {/* Arrowhead pointing up (N = 0°) */}
        <polygon points="32,10 28,26 32,22 36,26" fill="#2563eb" />
        {/* Tail */}
        <line x1="32" y1="22" x2="32" y2="50" stroke="#93c5fd" strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** SVG artificial horizon / attitude indicator showing roll and pitch. */
function AttitudeIndicator({ roll, pitch }: { roll: number; pitch: number }) {
  const cx = 100, cy = 100, r = 88;
  const pitchPx = 2.4; // pixels per degree of pitch

  // Point on arc at `deg` degrees from 12-o'clock at `rad` radius
  const arcPt = (deg: number, rad: number): [number, number] => [
    cx + rad * Math.sin((deg * Math.PI) / 180),
    cy - rad * Math.cos((deg * Math.PI) / 180),
  ];

  const arcR = 74;

  // [pitch degrees, half-width in px] – gaps at centre so symbol stays readable
  const pitchLines: Array<[number, number]> = [
    [30, 36], [20, 27], [10, 18], [-10, 18], [-20, 27], [-30, 36],
  ];

  // [roll scale angle, tick length]
  const rollTicks: Array<[number, number]> = [
    [-60, 5], [-45, 4], [-30, 8], [-20, 4], [-10, 4],
    [0, 9], [10, 4], [20, 4], [30, 8], [45, 4], [60, 5],
  ];

  const [ax1, ay1] = arcPt(-60, arcR);
  const [ax2, ay2] = arcPt(60, arcR);

  return (
    <svg viewBox="0 0 200 200" className="w-full h-full" aria-label={`Roll ${roll}° Pitch ${pitch}°`}>
      <defs>
        <clipPath id="ai-clip">
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>
      </defs>

      {/* ── Moving sphere: rotates for roll, translates for pitch ── */}
      <g clipPath="url(#ai-clip)" transform={`rotate(${-roll} ${cx} ${cy})`}>
        <g transform={`translate(0 ${pitch * pitchPx})`}>
          {/* Sky */}
          <rect x="-100" y="-300" width="400" height="400" fill="#1a56c5" />
          {/* Ground */}
          <rect x="-100" y="100" width="400" height="300" fill="#7b5044" />
          {/* Horizon line */}
          <line x1="-100" y1="100" x2="300" y2="100" stroke="white" strokeWidth="1.5" />
          {/* Pitch graduation lines */}
          {pitchLines.map(([deg, hw]) => {
            const y = 100 - deg * pitchPx;
            return (
              <g key={deg}>
                <line x1={cx - hw} y1={y} x2={cx - 5} y2={y} stroke="white" strokeWidth="1" opacity="0.75" />
                <line x1={cx + 5} y1={y} x2={cx + hw} y2={y} stroke="white" strokeWidth="1" opacity="0.75" />
                <text x={cx + hw + 3} y={y + 3.5} fontSize="6" fill="white" opacity="0.6">{Math.abs(deg)}</text>
                <text x={cx - hw - 3} y={y + 3.5} fontSize="6" fill="white" opacity="0.6" textAnchor="end">{Math.abs(deg)}</text>
              </g>
            );
          })}
        </g>
      </g>

      {/* ── Fixed roll scale arc (–60° to +60°) ── */}
      <path
        d={`M ${ax1.toFixed(2)} ${ay1.toFixed(2)} A ${arcR} ${arcR} 0 0 1 ${ax2.toFixed(2)} ${ay2.toFixed(2)}`}
        fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1"
      />
      {rollTicks.map(([deg, len]) => {
        const [ox, oy] = arcPt(deg, arcR);
        const [ix, iy] = arcPt(deg, arcR - len);
        return (
          <line key={deg} x1={ox} y1={oy} x2={ix} y2={iy}
            stroke="rgba(255,255,255,0.65)"
            strokeWidth={deg === 0 || Math.abs(deg) === 30 ? 1.5 : 1}
          />
        );
      })}

      {/* ── Moving bank-angle pointer (rotates by roll) ── */}
      <g transform={`rotate(${roll} ${cx} ${cy})`}>
        <polygon
          points={`${cx},${cy - arcR - 6} ${cx - 5},${cy - arcR + 3} ${cx + 5},${cy - arcR + 3}`}
          fill="white" opacity="0.92"
        />
      </g>

      {/* ── Fixed aircraft symbol ── */}
      <line x1={cx - 36} y1={cy} x2={cx - 10} y2={cy} stroke="#fbbf24" strokeWidth="3.5" strokeLinecap="round" />
      <line x1={cx - 10} y1={cy} x2={cx - 10} y2={cy + 6} stroke="#fbbf24" strokeWidth="3.5" strokeLinecap="round" />
      <line x1={cx + 10} y1={cy} x2={cx + 36} y2={cy} stroke="#fbbf24" strokeWidth="3.5" strokeLinecap="round" />
      <line x1={cx + 10} y1={cy} x2={cx + 10} y2={cy + 6} stroke="#fbbf24" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={4} fill="#fbbf24" />

      {/* ── Bezel ── */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#0f172a" strokeWidth="5" />
      <circle cx={cx} cy={cy} r={r - 1.5} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
    </svg>
  );
}

/** Single orientation readout (label + value). */
function OrientationReadout({ label, value, sign = false, yaw = false }: {
  label: string; value: number | null; sign?: boolean; yaw?: boolean;
}) {
  let display: string;
  if (value === null) {
    display = '—';
  } else if (yaw) {
    display = `${Math.round(value)}°`;
  } else {
    const prefix = sign && value > 0 ? '+' : '';
    display = `${prefix}${value.toFixed(1)}°`;
  }
  return (
    <div>
      <div className="text-xs text-slate-500 uppercase tracking-widest mb-0.5">{label}</div>
      <div className="text-xl font-bold text-slate-800 font-mono leading-tight tabular-nums">{display}</div>
      {yaw && value !== null && (
        <div className="text-xs text-slate-500 font-semibold mt-0.5">{compassLabel(value)}</div>
      )}
    </div>
  );
}

// Dynamically import the map component to avoid SSR issues
const MapComponent = dynamic(() => import('./components/MapComponent'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-slate-100">
      <div className="text-slate-400">Loading map...</div>
    </div>
  )
});

interface Waypoint {
  id: string;
  lat: number;
  lng: number;
  order: number;
}

export default function MissionPlanner() {
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [status, setStatus] = useState<'idle' | 'running' | 'completed'>('idle');
  const [savedMissionId, setSavedMissionId] = useState<number | null>(null);
  const [missionName, setMissionName] = useState('My Mission');
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryData>({
    connected: false,
    wind_speed_knots: null,
    wind_direction_deg: null,
    timestamp: null,
    current_waypoint_seq: null,
    mission_count: null,
    gps_lat: null,
    gps_lon: null,
    gps_alt_m: null,
    gps_heading_deg: null,
    gps_speed_knots: null,
    gps_fix: false,
    roll_deg: null,
    pitch_deg: null,
    yaw_deg: null,
    capsized: false,
    battery_pct: null,
    battery_voltage_v: null,
    battery_current_a: null,
    armed: false,
    flight_mode: null,
  });
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  // Vehicle control state
  const [vehicleLoading, setVehicleLoading] = useState<'arm' | 'forceArm' | 'disarm' | 'mode' | null>(null);
  const [vehicleError, setVehicleError] = useState<string | null>(null);
  // Inline ARM confirmation flow
  const [armConfirmOpen, setArmConfirmOpen] = useState(false);
  const [skipArmConfirm, setSkipArmConfirm] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem('bo-at:skip-arm-confirm') === 'true'
  );
  const armConfirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          setTelemetry(JSON.parse(event.data) as TelemetryData);
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        setTelemetry(prev => ({ ...prev, connected: false }));
        // Auto-reconnect after 3 s; clear any pending timer first to avoid leaks
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        reconnectTimer.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, []);

  const handleMapClick = (lat: number, lng: number) => {
    setWaypoints(prevWaypoints => {
      const newWaypoint: Waypoint = {
        id: crypto.randomUUID(),
        lat,
        lng,
        order: prevWaypoints.length + 1
      };
      return [...prevWaypoints, newWaypoint];
    });
  };

  async function runUpload(setRunning: boolean) {
    if (waypoints.length === 0) return;
    setIsUploading(true);
    setApiError(null);
    setUploadSuccess(false);
    try {
      const mission = await saveMission({
        name: missionName,
        waypoints: waypoints.map(wp => ({ latitude: wp.lat, longitude: wp.lng })),
      });
      setSavedMissionId(mission.id);
      await uploadMissionToPixhawk(mission.id);
      if (setRunning) setStatus('running');
      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 3000);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : setRunning ? 'Mission start failed' : 'Re-upload failed');
    } finally {
      setIsUploading(false);
    }
  }

  const handleStartMission = () => runUpload(true);
  const handleReupload = () => runUpload(false);

  const handleSaveMission = async () => {
    if (waypoints.length === 0) return;
    setIsSaving(true);
    setApiError(null);
    try {
      const mission = await saveMission({
        name: missionName,
        waypoints: waypoints.map(wp => ({ latitude: wp.lat, longitude: wp.lng })),
      });
      setSavedMissionId(mission.id);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const handleExport = async () => {
    if (savedMissionId === null) return;
    setIsExporting(true);
    setApiError(null);
    try {
      await exportMissionFile(savedMissionId, `${missionName.replace(/\s+/g, '_').toLowerCase()}.waypoints`);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  const handleReset = () => {
    setWaypoints([]);
    setStatus('idle');
    setSavedMissionId(null);
    setApiError(null);
  };

  // ── Vehicle control handlers ─────────────────────────────────────────────

  function handleArmClick() {
    if (skipArmConfirm) {
      executeArm(false);
    } else {
      setArmConfirmOpen(true);
      // Auto-dismiss confirmation after 8 s if no action taken
      if (armConfirmTimer.current) clearTimeout(armConfirmTimer.current);
      armConfirmTimer.current = setTimeout(() => setArmConfirmOpen(false), 8000);
    }
  }

  async function executeArm(force: boolean) {
    if (armConfirmTimer.current) clearTimeout(armConfirmTimer.current);
    setArmConfirmOpen(false);
    setVehicleLoading(force ? 'forceArm' : 'arm');
    setVehicleError(null);
    try {
      await (force ? forceArmVehicle() : armVehicle());
    } catch (err) {
      setVehicleError(err instanceof Error ? err.message : 'Arm failed');
    } finally {
      setVehicleLoading(null);
    }
  }

  async function handleDisarm() {
    setVehicleLoading('disarm');
    setVehicleError(null);
    try {
      await disarmVehicle();
    } catch (err) {
      setVehicleError(err instanceof Error ? err.message : 'Disarm failed');
    } finally {
      setVehicleLoading(null);
    }
  }

  async function handleSetMode(mode: VehicleMode) {
    setVehicleLoading('mode');
    setVehicleError(null);
    try {
      await setVehicleMode(mode);
    } catch (err) {
      setVehicleError(err instanceof Error ? err.message : 'Mode change failed');
    } finally {
      setVehicleLoading(null);
    }
  }

  function toggleSkipArmConfirm(checked: boolean) {
    setSkipArmConfirm(checked);
    localStorage.setItem('bo-at:skip-arm-confirm', String(checked));
  }

  // ─────────────────────────────────────────────────────────────────────────

  const removeWaypoint = (id: string) => {
    setWaypoints(prevWaypoints => {
      const filtered = prevWaypoints.filter(wp => wp.id !== id);
      return filtered.map((wp, index) => ({ ...wp, order: index + 1 }));
    });
  };

  const vesselPosition = useMemo(() => {
    const { gps_lat, gps_lon, gps_heading_deg, gps_fix } = telemetry;
    if (
      gps_lat === null ||
      gps_lon === null ||
      (gps_lat === 0 && gps_lon === 0)
    ) {
      return null;
    }
    return { lat: gps_lat, lng: gps_lon, heading: gps_heading_deg, fix: gps_fix };
  }, [telemetry.gps_lat, telemetry.gps_lon, telemetry.gps_heading_deg, telemetry.gps_fix]);

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Navigation className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">
            BO-AT Mission Planner
          </h1>
        </div>
      </header>

      {/* Capsize Alert Banner */}
      {telemetry.capsized && (
        <div className="bg-red-600 text-white px-6 py-3 flex items-center justify-center gap-3 animate-pulse">
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <span className="font-bold text-sm tracking-wide uppercase">
            Capsize Detected — Roll {telemetry.roll_deg !== null ? `${telemetry.roll_deg}°` : ''}
          </span>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left column: map + orientation panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 relative min-h-0">
            <MapComponent
              waypoints={waypoints}
              onMapClick={handleMapClick}
              onWaypointRemove={removeWaypoint}
              activeWaypointOrder={
                status === 'running' && telemetry.current_waypoint_seq !== null
                  ? telemetry.current_waypoint_seq + 1
                  : undefined
              }
              vesselPosition={vesselPosition}
            />
          </div>

          {/* Bottom strip: Orientation + Metrics */}
          <div className="bg-white border-t border-slate-200 flex flex-shrink-0 overflow-hidden">
            {/* Left sub-section: Orientation */}
            <div className="flex items-center gap-6 px-6 py-4 border-r border-slate-200">
              {/* Attitude indicator */}
              <div className="w-36 h-36 flex-shrink-0">
                {telemetry.roll_deg !== null && telemetry.pitch_deg !== null ? (
                  <AttitudeIndicator roll={telemetry.roll_deg} pitch={telemetry.pitch_deg} />
                ) : (
                  <div className="w-full h-full rounded-full border border-slate-200 flex items-center justify-center">
                    <span className="text-slate-400 text-xs">No signal</span>
                  </div>
                )}
              </div>

              {/* Readouts */}
              <div className="flex flex-col gap-1">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">
                  Orientation
                </div>
                <div className="grid grid-cols-3 gap-6">
                  <OrientationReadout label="Roll"  value={telemetry.roll_deg}  sign />
                  <OrientationReadout label="Pitch" value={telemetry.pitch_deg} sign />
                  <OrientationReadout label="Yaw"   value={telemetry.yaw_deg}   yaw />
                </div>
              </div>
            </div>

            {/* Right sub-section: Metrics */}
            <div className="flex-1 px-6 py-4 overflow-y-auto">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Metrics</h3>
                {/* Radio connection status */}
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${telemetry.connected ? 'bg-emerald-500 animate-pulse' : 'bg-red-400'}`} />
                  <span className="text-xs text-slate-500">
                    {telemetry.connected ? 'SiK radio connected' : 'Radio disconnected'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3">
                {/* Battery */}
                <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-lg p-3 border border-emerald-200">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Battery className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Battery</span>
                  </div>
                  <BatteryIcon pct={telemetry.battery_pct} />
                  <div className="text-2xl font-bold text-emerald-700 tabular-nums mt-1">
                    {telemetry.battery_pct !== null
                      ? <>{telemetry.battery_pct}<span className="text-lg ml-0.5">%</span></>
                      : <span className="text-slate-400">—</span>}
                  </div>
                  <div className="flex gap-2 mt-1.5">
                    <span className="text-xs font-mono text-emerald-600">
                      {telemetry.battery_voltage_v !== null ? `${telemetry.battery_voltage_v}V` : '—'}
                    </span>
                    <span className="text-xs text-emerald-300">·</span>
                    <span className="text-xs font-mono text-emerald-600">
                      {telemetry.battery_current_a !== null ? `${telemetry.battery_current_a}A` : '—'}
                    </span>
                  </div>
                </div>

                {/* Wind Speed */}
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-3 border border-blue-200">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Wind className="w-3.5 h-3.5 text-blue-600" />
                    <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Wind Speed</span>
                  </div>
                  <div className="text-2xl font-bold text-blue-700">
                    {telemetry.wind_speed_knots !== null
                      ? <>{telemetry.wind_speed_knots.toFixed(1)}<span className="text-sm ml-1">kts</span></>
                      : <span className="text-slate-400">—</span>}
                  </div>
                </div>

                {/* Boat Speed */}
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-3 border border-purple-200">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Gauge className="w-3.5 h-3.5 text-purple-600" />
                    <span className="text-xs font-semibold text-purple-700 uppercase tracking-wide">Speed</span>
                  </div>
                  <div className="text-2xl font-bold text-purple-700">
                    {telemetry.gps_speed_knots !== null
                      ? <>{telemetry.gps_speed_knots.toFixed(1)}<span className="text-sm ml-1">kts</span></>
                      : <span className="text-slate-400">—</span>}
                  </div>
                </div>

                {/* Wind Direction */}
                <div className="bg-gradient-to-br from-sky-50 to-sky-100 rounded-lg p-3 border border-sky-200">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Wind className="w-3.5 h-3.5 text-sky-600" />
                    <span className="text-xs font-semibold text-sky-700 uppercase tracking-wide">Wind Dir</span>
                  </div>
                  {telemetry.wind_direction_deg !== null ? (
                    <div className="flex flex-col items-center gap-1">
                      <WindCompass deg={telemetry.wind_direction_deg} className="w-10 h-10 flex-shrink-0" />
                      <div className="text-center">
                        <div className="text-lg font-bold text-sky-700 leading-tight">
                          {Math.round(telemetry.wind_direction_deg)}°
                        </div>
                        <div className="text-xs font-semibold text-sky-500">
                          {compassLabel(telemetry.wind_direction_deg)}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-2xl font-bold text-slate-400">—</div>
                  )}
                </div>
              </div>

              {/* GPS Status */}
              <div className="mt-3 bg-gradient-to-br from-slate-50 to-slate-100 rounded-lg px-4 py-2.5 border border-slate-200">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-slate-600" />
                    <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">GPS</span>
                    <span className={`w-2 h-2 rounded-full ${telemetry.gps_fix ? 'bg-emerald-500 animate-pulse' : 'bg-red-400'}`} />
                    <span className="text-xs text-slate-500">
                      {telemetry.gps_fix ? 'Fix' : telemetry.gps_lat !== null ? 'Stale' : 'No fix'}
                    </span>
                  </div>
                  <div className="flex gap-4 text-xs font-mono text-slate-600">
                    <span>Lat: {telemetry.gps_lat !== null ? telemetry.gps_lat.toFixed(6) : '—'}</span>
                    <span>Lng: {telemetry.gps_lon !== null ? telemetry.gps_lon.toFixed(6) : '—'}</span>
                    {telemetry.gps_heading_deg !== null && (
                      <span>Hdg: {telemetry.gps_heading_deg.toFixed(1)}°</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Control Panel */}
        <div className="w-96 bg-white border-l border-slate-200 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">

            {/* ── Vehicle Control ─────────────────────────────────────── */}
            <div>
              <h2 className="text-xl font-bold text-slate-800 mb-4">Vehicle Control</h2>

              {/* Disabled notice when radio is disconnected */}
              {!telemetry.connected && (
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-4 text-xs text-slate-500">
                  <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
                  Radio disconnected — vehicle controls unavailable
                </div>
              )}

              {/* Status badges */}
              <div className="flex items-center gap-2 mb-4">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${
                  telemetry.armed
                    ? 'bg-red-100 text-red-700 border border-red-300'
                    : 'bg-slate-100 text-slate-500 border border-slate-200'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${telemetry.armed ? 'bg-red-500 animate-pulse' : 'bg-slate-400'}`} />
                  {telemetry.armed ? 'Armed' : 'Disarmed'}
                </span>
                {telemetry.flight_mode && (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-blue-50 text-blue-700 border border-blue-200">
                    {telemetry.flight_mode}
                  </span>
                )}
              </div>

              {/* Arm / Disarm */}
              <div className="flex gap-2 mb-2">
                <button
                  onClick={handleArmClick}
                  disabled={telemetry.armed || vehicleLoading !== null || !telemetry.connected}
                  className="flex-1 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 disabled:from-slate-300 disabled:to-slate-400 text-white font-semibold py-2 px-3 rounded-lg text-sm shadow-md shadow-red-500/20 disabled:shadow-none transition-all duration-200"
                >
                  {vehicleLoading === 'arm' ? 'Arming…' : vehicleLoading === 'forceArm' ? 'Force arming…' : 'Arm'}
                </button>
                <button
                  onClick={handleDisarm}
                  disabled={!telemetry.armed || vehicleLoading !== null || !telemetry.connected}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 disabled:bg-slate-50 disabled:text-slate-300 text-slate-700 font-semibold py-2 px-3 rounded-lg text-sm border border-slate-200 transition-all duration-200"
                >
                  {vehicleLoading === 'disarm' ? 'Disarming…' : 'Disarm'}
                </button>
              </div>

              {/* Inline ARM confirmation */}
              {armConfirmOpen && (
                <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 mb-2">
                  <p className="text-sm font-semibold text-amber-800 mb-2">Confirm arming the vessel?</p>
                  <label className="flex items-center gap-2 text-xs text-amber-700 mb-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={skipArmConfirm}
                      onChange={e => toggleSkipArmConfirm(e.target.checked)}
                      className="rounded"
                    />
                    Don't ask again
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { if (armConfirmTimer.current) clearTimeout(armConfirmTimer.current); setArmConfirmOpen(false); }}
                      className="flex-1 py-1.5 px-3 rounded-md text-xs font-semibold bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => executeArm(false)}
                      className="flex-1 py-1.5 px-3 rounded-md text-xs font-semibold bg-red-500 hover:bg-red-600 text-white transition-colors"
                    >
                      Confirm Arm
                    </button>
                    <button
                      onClick={() => executeArm(true)}
                      className="flex-1 py-1.5 px-3 rounded-md text-xs font-semibold bg-red-900 hover:bg-red-800 text-white transition-colors"
                      title="Bypasses pre-arm safety checks"
                    >
                      Force Arm
                    </button>
                  </div>
                </div>
              )}

              {/* Mode buttons */}
              <div className="grid grid-cols-3 gap-2 mb-2">
                {(['MANUAL', 'HOLD', 'AUTO'] as VehicleMode[]).map(mode => {
                  const active = telemetry.flight_mode === mode;
                  return (
                    <button
                      key={mode}
                      onClick={() => handleSetMode(mode)}
                      disabled={vehicleLoading !== null || !telemetry.connected}
                      className={`py-2 rounded-lg text-xs font-bold uppercase tracking-wide border transition-all duration-150 ${
                        active
                          ? 'bg-blue-500 text-white border-blue-500 shadow-md shadow-blue-500/25'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 disabled:opacity-40'
                      }`}
                    >
                      {vehicleLoading === 'mode' && !active ? '…' : mode}
                    </button>
                  );
                })}
              </div>

              {vehicleError && (
                <p className="text-xs text-red-500 mt-1">{vehicleError}</p>
              )}
            </div>

            {/* ── Mission Control ─────────────────────────────────────── */}
            {/* Mission Control */}
            <div>
              <h2 className="text-xl font-bold text-slate-800 mb-4">Mission Control</h2>

              {/* Upload success banner */}
              {uploadSuccess && (
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-300 text-emerald-700 text-sm font-medium px-4 py-2 rounded-lg mb-3">
                  <CheckCircle className="w-4 h-4 flex-shrink-0" />
                  Waypoints uploaded to Pixhawk successfully
                </div>
              )}

              <button
                onClick={handleStartMission}
                disabled={waypoints.length === 0 || status === 'running' || isUploading}
                className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 disabled:from-slate-300 disabled:to-slate-400 text-white font-semibold py-3 px-4 rounded-lg shadow-lg shadow-emerald-500/25 disabled:shadow-none transition-all duration-200 flex items-center justify-center gap-2 mb-3"
              >
                <Play className="w-5 h-5 fill-current" />
                {isUploading && status === 'idle' ? 'Uploading…' : 'Start Mission'}
              </button>

              {/* Re-upload button — visible once mission is running */}
              {status === 'running' && (
                <button
                  onClick={handleReupload}
                  disabled={isUploading}
                  className="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-slate-300 disabled:to-slate-400 text-white font-semibold py-2 px-4 rounded-lg shadow-lg shadow-blue-500/25 disabled:shadow-none transition-all duration-200 flex items-center justify-center gap-2 mb-3"
                >
                  <Upload className="w-4 h-4" />
                  {isUploading ? 'Uploading…' : 'Re-upload to Pixhawk'}
                </button>
              )}

              <button
                onClick={handleReset}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-2 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Reset
              </button>

              {/* Mission name + Save / Export */}
              <div className="mt-4 space-y-2">
                <input
                  type="text"
                  value={missionName}
                  onChange={e => { setMissionName(e.target.value); setSavedMissionId(null); }}
                  placeholder="Mission name"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleSaveMission}
                    disabled={waypoints.length === 0 || isSaving}
                    className="bg-blue-500 hover:bg-blue-600 disabled:bg-slate-300 text-white font-semibold py-2 px-3 rounded-lg text-sm transition-colors duration-200 flex items-center justify-center gap-1"
                  >
                    <Save className="w-4 h-4" />
                    {isSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={handleExport}
                    disabled={savedMissionId === null || isExporting}
                    className="bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-300 text-white font-semibold py-2 px-3 rounded-lg text-sm transition-colors duration-200 flex items-center justify-center gap-1"
                  >
                    <Download className="w-4 h-4" />
                    {isExporting ? 'Exporting…' : 'Export'}
                  </button>
                </div>
                {savedMissionId !== null && (
                  <p className="text-xs text-emerald-600 font-medium">
                    Saved as mission #{savedMissionId} — ready to export
                  </p>
                )}
                {apiError && (
                  <p className="text-xs text-red-500">{apiError}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <div className="text-sm font-medium text-slate-600 mb-1">Status:</div>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${
                      status === 'idle' ? 'bg-slate-400' :
                      status === 'running' ? 'bg-emerald-500 animate-pulse' :
                      'bg-blue-500'
                    }`} />
                    <span className="text-sm font-semibold text-slate-700 capitalize">
                      {status}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium text-slate-600 mb-1">Waypoints:</div>
                  <div className="text-2xl font-bold text-slate-800">
                    {waypoints.length}
                  </div>
                </div>
              </div>
            </div>

            {/* Waypoints List */}
            <div>
              <h3 className="text-lg font-bold text-slate-800 mb-3 flex items-center gap-2">
                <Navigation className="w-5 h-5 text-blue-500" />
                Waypoints
              </h3>
              
              {waypoints.length === 0 ? (
                <div className="text-center py-8 px-4 bg-slate-50 rounded-lg border border-dashed border-slate-300">
                  <p className="text-sm text-slate-500">
                    Click on the map to add waypoints
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {waypoints.map((wp) => {
                    // Map 1-indexed order to 0-indexed MAVLink seq for status comparison
                    const seq = wp.order - 1;
                    const isActive = status === 'running' && telemetry.current_waypoint_seq === seq;
                    const isCompleted = status === 'running' && telemetry.current_waypoint_seq !== null && seq < telemetry.current_waypoint_seq;
                    return (
                    <div
                      key={wp.id}
                      className={`rounded-lg p-3 transition-colors duration-150 group ${
                        isActive
                          ? 'bg-orange-50 border border-orange-300 ring-1 ring-orange-300'
                          : isCompleted
                          ? 'bg-slate-50 opacity-60'
                          : 'bg-slate-50 hover:bg-slate-100'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center ${
                              isActive ? 'bg-orange-500' :
                              isCompleted ? 'bg-slate-400' :
                              wp.order === 1 && waypoints.length > 1 ? 'bg-emerald-500' :
                              wp.order === waypoints.length && waypoints.length > 1 ? 'bg-red-500' :
                              'bg-blue-500'
                            }`}>
                              {isCompleted ? '✓' : wp.order}
                            </span>
                            <span className={`font-semibold text-sm ${isActive ? 'text-orange-700' : isCompleted ? 'text-slate-400' : 'text-slate-700'}`}>
                              {wp.order === 1 && waypoints.length > 1 ? 'Start' :
                               wp.order === waypoints.length && waypoints.length > 1 ? 'End' :
                               `Waypoint ${wp.order}`}
                            </span>
                            {isActive && (
                              <span className="ml-auto text-xs font-semibold text-orange-600 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                                Active
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 font-mono ml-8">
                            <div>Lat: {wp.lat.toFixed(6)}</div>
                            <div>Lng: {wp.lng.toFixed(6)}</div>
                          </div>
                        </div>
                        <button
                          onClick={() => removeWaypoint(wp.id)}
                          className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all duration-150"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ); })}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}