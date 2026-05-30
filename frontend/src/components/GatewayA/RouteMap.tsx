import { useEffect, useRef, useState } from 'react';
import type { Itinerary } from '../../types/api';

// Lazy-import Leaflet so it only loads when the map is actually shown
// (Leaflet touches `window` and fails SSR; this pattern is also lighter)

interface Props {
  itinerary:  Itinerary;
  originLat:  number;
  originLon:  number;
}

const PILLAR_COLORS: Record<string, string> = {
  shelter:     '#1A7A9A',
  rehab:       '#3A8A71',
  food:        '#D97706',
  hygiene:     '#506170',
  supplies:    '#0F4259',
  respite:     '#7C3AED',
  youth_spaces:'#0891B2',
  libraries:   '#B45309',
};

function pillarColor(pillar: string) {
  return PILLAR_COLORS[pillar] ?? '#506170';
}

export function RouteMap({ itinerary, originLat, originLon }: Props) {
  const [open, setOpen] = useState(false);
  const mapRef     = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<unknown>(null);   // holds the L.Map instance

  useEffect(() => {
    if (!open || !mapRef.current) return;
    if (leafletRef.current) return;   // already initialised

    let cancelled = false;
    // Leaflet CSS loaded via index.css @import — dynamic import causes TS errors in strict mode
    import('leaflet').then(({ default: L }) => {
      if (cancelled || !mapRef.current || leafletRef.current) return;
      (() => {
        if (cancelled || !mapRef.current || leafletRef.current) return;

        const map = L.map(mapRef.current, { zoomControl: true, attributionControl: false });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors',
        }).addTo(map);

        const bounds: [number, number][] = [];

        // Origin marker
        const originIcon = L.divIcon({
          html: `<div style="width:14px;height:14px;border-radius:50%;background:#FFFFFF;border:3px solid #1A7A9A;box-shadow:0 0 0 3px rgba(26,122,154,0.3)"></div>`,
          iconSize: [14, 14], iconAnchor: [7, 7], className: '',
        });
        L.marker([originLat, originLon], { icon: originIcon })
          .bindPopup('<b>Your location</b>')
          .addTo(map);
        bounds.push([originLat, originLon]);

        // Result markers
        Object.entries(itinerary).forEach(([pillar, results]) => {
          const color = pillarColor(pillar);
          results.forEach((r, idx) => {
            if (!r.lat || !r.lon) return;
            const size   = idx === 0 ? 14 : 10;
            const border = idx === 0 ? 2 : 1.5;
            const icon = L.divIcon({
              html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:${border}px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.35)"></div>`,
              iconSize: [size, size], iconAnchor: [size/2, size/2], className: '',
            });
            const popup = `
              <div style="font-size:12px;line-height:1.5;min-width:160px">
                <b style="color:${color}">${pillar.toUpperCase()}</b><br/>
                <b>${r.name}</b><br/>
                <span style="color:#666">${r.address}</span><br/>
                ${r.phone ? `📞 ${r.phone}<br/>` : ''}
                🚶 ${r.distance_walk_min} min &nbsp; ${Math.round(r.occupancy_ratio * 100)}% full
              </div>`;
            L.marker([r.lat, r.lon], { icon }).bindPopup(popup).addTo(map);
            bounds.push([r.lat, r.lon]);
          });
        });

        if (bounds.length > 1) {
          map.fitBounds(bounds as [number, number][], { padding: [32, 32] });
        } else {
          map.setView([originLat, originLon], 14);
        }

        leafletRef.current = map;
      })();
    });

    return () => { cancelled = true; };
  }, [open, itinerary, originLat, originLon]);

  // Cleanup map on unmount
  useEffect(() => {
    return () => {
      if (leafletRef.current) {
        (leafletRef.current as { remove: () => void }).remove();
        leafletRef.current = null;
      }
    };
  }, []);

  const pillars = Object.entries(itinerary).filter(([, r]) => r.length > 0);
  if (pillars.length === 0) return null;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid #D0D8DE' }}>
      {/* Toggle bar */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 transition-all"
        style={{ background: open ? '#EFF9FB' : 'white', borderBottom: open ? '1px solid #AADEED' : 'none' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-base">🗺</span>
          <span className="text-sm font-semibold" style={{ color: '#0F4259' }}>Map View</span>
          {/* Pillar legend dots */}
          <div className="flex items-center gap-1 ml-1">
            {pillars.map(([pillar]) => (
              <div key={pillar}
                className="w-2.5 h-2.5 rounded-full"
                style={{ background: pillarColor(pillar) }}
                title={pillar}
              />
            ))}
          </div>
        </div>
        <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
          style={{ color: '#8A9BAA' }} fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div ref={mapRef} style={{ height: 340, width: '100%', background: '#E9EDF0' }} />
      )}
    </div>
  );
}
