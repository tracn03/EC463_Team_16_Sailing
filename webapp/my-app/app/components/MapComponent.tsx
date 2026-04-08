'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface Waypoint {
  id: string;
  lat: number;
  lng: number;
  order: number;
}

interface VesselPosition {
  lat: number;
  lng: number;
  heading: number | null;
  fix: boolean;
}

interface MapComponentProps {
  waypoints: Waypoint[];
  onMapClick: (lat: number, lng: number) => void;
  onWaypointRemove: (id: string) => void;
  activeWaypointOrder?: number;
  vesselPosition?: VesselPosition | null;
}

function buildVesselIcon(heading: number | null, fix: boolean): L.DivIcon {
  const color = fix ? '#0ea5e9' : '#94a3b8';
  const opacity = fix ? '1' : '0.6';

  // Heading arrow: a triangle outside the circle pointing in travel direction.
  // SVG rotated around the marker centre (24,24).
  const arrow = heading !== null
    ? `<g transform="rotate(${heading}, 24, 24)">
         <polygon points="24,3 19,14 24,10 29,14" fill="${color}" opacity="${opacity}" />
       </g>`
    : '';

  return L.divIcon({
    className: '',
    html: `<svg viewBox="0 0 48 48" width="48" height="48" xmlns="http://www.w3.org/2000/svg">
      ${arrow}
      <circle cx="24" cy="24" r="11" fill="${color}" stroke="white" stroke-width="2.5" opacity="${opacity}" />
      <circle cx="24" cy="24" r="4"  fill="white" opacity="${opacity}" />
    </svg>`,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  });
}

export default function MapComponent({ waypoints, onMapClick, onWaypointRemove, activeWaypointOrder, vesselPosition }: MapComponentProps) {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<{ [key: string]: L.Marker }>({});
  const polylineRef = useRef<L.Polyline | null>(null);
  const arrowsRef = useRef<L.Polyline[]>([]);
  const vesselMarkerRef = useRef<L.Marker | null>(null);

  // Keep a stable ref to onMapClick so the map-init closure never goes stale
  const onMapClickRef = useRef(onMapClick);
  useEffect(() => { onMapClickRef.current = onMapClick; }, [onMapClick]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [42.36, -71.06], //map center
      zoom: 13,
      zoomControl: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    map.on('click', (e) => {
      onMapClickRef.current(e.latlng.lat, e.latlng.lng);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Vessel marker — updated independently of waypoints
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    if (!vesselPosition) {
      if (vesselMarkerRef.current) {
        map.removeLayer(vesselMarkerRef.current);
        vesselMarkerRef.current = null;
      }
      return;
    }

    const { lat, lng, heading, fix } = vesselPosition;
    const icon = buildVesselIcon(heading, fix);

    if (vesselMarkerRef.current) {
      vesselMarkerRef.current.setLatLng([lat, lng]);
      vesselMarkerRef.current.setIcon(icon);
    } else {
      vesselMarkerRef.current = L.marker([lat, lng], { icon, zIndexOffset: 1000 })
        .bindTooltip('Vessel', { permanent: false, direction: 'top' })
        .addTo(map);
    }
  }, [vesselPosition]);

  const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  };

  useEffect(() => {
    if (!mapRef.current) return;

    const map = mapRef.current;

    // Remove old markers
    Object.values(markersRef.current).forEach(marker => {
      map.removeLayer(marker);
    });
    markersRef.current = {};

    // Remove old polyline
    if (polylineRef.current) {
      map.removeLayer(polylineRef.current);
      polylineRef.current = null;
    }

    // Remove old arrows
    arrowsRef.current.forEach(arrow => {
      map.removeLayer(arrow);
    });
    arrowsRef.current = [];

    // Add new markers
    waypoints.forEach((wp, index) => {
      const isActive = activeWaypointOrder !== undefined && wp.order === activeWaypointOrder;
      const isCompleted = activeWaypointOrder !== undefined && wp.order < activeWaypointOrder;

      let markerColor = '#3b82f6'; // Blue default
      if (isActive) {
        markerColor = '#f97316'; // Orange for active waypoint
      } else if (isCompleted) {
        markerColor = '#94a3b8'; // Muted slate for completed
      } else if (index === 0 && waypoints.length > 1) {
        markerColor = '#10b981'; // Green for start
      } else if (index === waypoints.length - 1 && waypoints.length > 1) {
        markerColor = '#ef4444'; // Red for end
      }

      const icon = L.divIcon({
        className: 'custom-waypoint-marker',
        html: `
          <div style="
            width: 40px;
            height: 40px;
            background: ${markerColor};
            border: 3px solid white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            color: white;
            font-size: 16px;
            box-shadow: ${isActive ? `0 0 0 3px ${markerColor}, 0 4px 12px rgba(0,0,0,0.3)` : '0 4px 12px rgba(0, 0, 0, 0.3)'};
            cursor: pointer;
            transition: transform 0.2s;
          ">
            ${isCompleted ? '✓' : wp.order}
          </div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
      });

      // Calculate distance to next waypoint if exists
      let distanceDisplay = '';
      if (index < waypoints.length - 1) {
        const nextWp = waypoints[index + 1];
        const distance = calculateDistance(wp.lat, wp.lng, nextWp.lat, nextWp.lng);
        distanceDisplay = distance < 1000
          ? `Next: ${Math.round(distance)}m`
          : `Next: ${(distance / 1000).toFixed(2)}km`;
      }

      // Build popup content using DOM nodes — no HTML string interpolation
      const container = L.DomUtil.create('div');
      Object.assign(container.style, {
        fontFamily: 'system-ui, sans-serif',
        padding: '4px',
        minWidth: '150px',
      });

      // Header row: colored circle + label
      const header = L.DomUtil.create('div', '', container);
      Object.assign(header.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '8px',
      });

      const circle = L.DomUtil.create('div', '', header);
      Object.assign(circle.style, {
        width: '24px',
        height: '24px',
        background: markerColor,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        fontWeight: 'bold',
        fontSize: '12px',
      });
      circle.textContent = String(wp.order);

      const label = L.DomUtil.create('strong', '', header);
      Object.assign(label.style, { color: '#1e293b', fontSize: '14px' });
      label.textContent =
        index === 0 && waypoints.length > 1 ? 'Start Point' :
        index === waypoints.length - 1 && waypoints.length > 1 ? 'End Point' :
        `Waypoint ${wp.order}`;

      // Lat/lng display
      const coords = L.DomUtil.create('div', '', container);
      Object.assign(coords.style, {
        marginTop: '4px',
        fontSize: '12px',
        color: '#64748b',
        fontFamily: 'monospace',
      });
      const latLine = L.DomUtil.create('div', '', coords);
      latLine.textContent = `Lat: ${wp.lat.toFixed(6)}`;
      const lngLine = L.DomUtil.create('div', '', coords);
      lngLine.textContent = `Lng: ${wp.lng.toFixed(6)}`;

      // Distance to next waypoint
      if (distanceDisplay) {
        const distEl = L.DomUtil.create('div', '', container);
        Object.assign(distEl.style, { marginTop: '4px', fontSize: '11px', color: '#64748b' });
        distEl.textContent = distanceDisplay;
      }

      // Remove button — event attached via L.DomEvent, no inline onclick
      const removeBtn = L.DomUtil.create('button', '', container);
      Object.assign(removeBtn.style, {
        marginTop: '8px',
        width: '100%',
        background: '#ef4444',
        color: 'white',
        border: 'none',
        padding: '6px 12px',
        borderRadius: '6px',
        fontSize: '12px',
        fontWeight: '600',
        cursor: 'pointer',
      });
      removeBtn.textContent = 'Remove Waypoint';
      removeBtn.addEventListener('mouseover', () => { removeBtn.style.background = '#dc2626'; });
      removeBtn.addEventListener('mouseout', () => { removeBtn.style.background = '#ef4444'; });
      L.DomEvent.on(removeBtn, 'click', () => { onWaypointRemove(wp.id); });

      const marker = L.marker([wp.lat, wp.lng], { icon })
        .addTo(map)
        .bindPopup(container);

      markersRef.current[wp.id] = marker;
    });

    if (waypoints.length > 1) {
      const coordinates = waypoints.map(wp => [wp.lat, wp.lng] as [number, number]);

      polylineRef.current = L.polyline(coordinates, {
        color: '#3b82f6',
        weight: 4,
        opacity: 0.8,
        lineJoin: 'round',
        lineCap: 'round'
      }).addTo(map);
    }
  }, [waypoints, onWaypointRemove, activeWaypointOrder]);

  return (
    <div ref={mapContainerRef} className="w-full h-full" />
  );
}