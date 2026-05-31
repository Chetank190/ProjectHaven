import { useEffect, useRef, useState } from 'react';
import { useSpeech }  from '../shared/useSpeech';
import api            from '../../api/client';
import type { Itinerary, ItineraryResult, NearbyService, NearbyResponse } from '../../types/api';

interface Props {
  itinerary:  Itinerary;
  ttsScript:  string;
  onReset:    () => void;
  originLat:  number;
  originLon:  number;
  hubName:    string;
  onReserve?: (result: ItineraryResult, pillar: string) => void;
}

const PILLAR_COLOR: Record<string, string> = {
  shelter:      '#1A7A9A',
  rehab:        '#3A8A71',
  food:         '#D97706',
  hygiene:      '#506170',
  supplies:     '#38AED2',
  respite:      '#7C3AED',
  youth:        '#0891B2',
  library:      '#B45309',
};

const PILLAR_ICON: Record<string, string> = {
  shelter:  '🏠',
  rehab:    '💊',
  food:     '🍽',
  hygiene:  '🚿',
  supplies: '🧤',
  respite:  '☕',
  youth:    '🧑',
  library:  '📚',
};

const ALL_BROWSE_PILLARS = ['shelter','food','rehab','hygiene','youth','library','respite'];

function pColor(pillar: string) { return PILLAR_COLOR[pillar] ?? '#38AED2'; }
function pIcon(pillar: string)  { return PILLAR_ICON[pillar]  ?? '📍'; }

function directionsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=walking`;
}

export function KioskItinerary({ itinerary, ttsScript, onReset, originLat, originLon, hubName, onReserve }: Props) {
  const { speak, stopSpeaking, isSpeaking } = useSpeech();
  const mapRef     = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<unknown>(null);

  const [tab,           setTab]           = useState<'route' | 'browse'>('route');
  const [browseFilter,  setBrowseFilter]  = useState<string>('all');
  const [nearby,        setNearby]        = useState<NearbyService[] | null>(null);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError,   setNearbyError]   = useState(false);

  useEffect(() => {
    speak(ttsScript);
    return () => stopSpeaking();
  }, []);

  const stops = Object.entries(itinerary)
    .filter(([, results]) => results.length > 0)
    .map(([pillar, results]) => ({ pillar, result: results[0] }));

  // ── Fetch nearby services when browse tab opens ───────────────────────────
  useEffect(() => {
    if (tab !== 'browse' || nearby !== null) return;
    setNearbyLoading(true);
    setNearbyError(false);
    api.get<NearbyResponse>('/nearby', {
      params: { lat: originLat, lon: originLon, radius_km: 2.0, limit: 80 },
    }).then(r => {
      setNearby(r.data.services);
    }).catch(() => {
      setNearbyError(true);
    }).finally(() => {
      setNearbyLoading(false);
    });
  }, [tab]);

  // ── Destroy Leaflet instance when leaving route tab so it can rebuild on return ─
  useEffect(() => {
    if (tab !== 'route' && leafletRef.current) {
      (leafletRef.current as { remove: () => void }).remove();
      leafletRef.current = null;
    }
  }, [tab]);

  // ── Build Leaflet map when route tab is active and no map exists ──────────
  useEffect(() => {
    if (tab !== 'route' || !mapRef.current || leafletRef.current) return;
    let cancelled = false;

    import('leaflet').then(({ default: L }) => {
      if (cancelled || !mapRef.current || leafletRef.current) return;

      const map = L.map(mapRef.current, { zoomControl: false, attributionControl: false });

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_matter/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd', maxZoom: 19,
      }).addTo(map);

      L.circle([originLat, originLon], {
        radius: 500, color: '#38AED2', weight: 1, opacity: 0.35, fillOpacity: 0, dashArray: '5 7',
      }).addTo(map);
      L.circle([originLat, originLon], {
        radius: 1000, color: '#38AED2', weight: 1, opacity: 0.18, fillOpacity: 0, dashArray: '3 9',
      }).addTo(map);

      const originIcon = L.divIcon({
        html: `<div style="position:relative;width:28px;height:28px">
          <div style="position:absolute;inset:0;border-radius:50%;background:rgba(56,174,210,0.3);animation:kiosk-pulse 2s ease-out infinite"></div>
          <div style="position:absolute;inset:5px;border-radius:50%;background:#38AED2;border:2.5px solid #fff;box-shadow:0 0 10px rgba(56,174,210,0.7)"></div>
        </div>`,
        iconSize: [28, 28], iconAnchor: [14, 14], className: '',
      });
      L.marker([originLat, originLon], { icon: originIcon })
        .bindPopup(`<b style="font-size:13px">📍 You are here</b><br/><span style="color:#555">${hubName}</span>`)
        .addTo(map);

      const bounds: [number, number][] = [[originLat, originLon]];

      stops.forEach(({ pillar, result }, i) => {
        if (!result.lat || !result.lon) return;
        const color = pColor(pillar);
        const num   = i + 1;
        const pin = L.divIcon({
          html: `<svg width="34" height="42" viewBox="0 0 34 42" xmlns="http://www.w3.org/2000/svg">
            <path d="M17 1C8.716 1 2 7.716 2 16c0 10.5 15 25 15 25S32 26.5 32 16C32 7.716 25.284 1 17 1z"
              fill="${color}" stroke="rgba(255,255,255,0.9)" stroke-width="2.5"/>
            <text x="17" y="21" text-anchor="middle" fill="white" font-size="13" font-weight="700" font-family="system-ui,sans-serif">${num}</text>
          </svg>`,
          iconSize: [34, 42], iconAnchor: [17, 42], className: '',
        });
        const popup = `<div style="font-family:system-ui,sans-serif;min-width:200px;line-height:1.6">
          <div style="color:${color};text-transform:uppercase;font-size:11px;font-weight:700;letter-spacing:0.06em">${pillar}</div>
          <div style="font-size:15px;font-weight:700;margin:2px 0">${result.name}</div>
          <div style="color:#666;font-size:12px">${result.address}</div>
          <div style="font-size:14px;font-weight:600;margin-top:4px;color:#222">🚶 ${result.distance_walk_min} min · ${result.distance_km.toFixed(1)} km</div>
          <a href="${directionsUrl(result.lat, result.lon)}" target="_blank"
            style="display:inline-block;margin-top:6px;font-size:12px;color:${color};font-weight:600">
            Get walking directions →
          </a>
        </div>`;
        L.marker([result.lat, result.lon], { icon: pin }).bindPopup(popup).addTo(map);
        bounds.push([result.lat, result.lon]);
      });

      if (bounds.length > 1) {
        map.fitBounds(bounds as [number, number][], { padding: [44, 44] });
      } else {
        map.setView([originLat, originLon], 15);
      }

      leafletRef.current = map;
    });

    return () => { cancelled = true; };
  }, [tab]);

  // Full component unmount cleanup
  useEffect(() => {
    return () => {
      if (leafletRef.current) {
        (leafletRef.current as { remove: () => void }).remove();
        leafletRef.current = null;
      }
    };
  }, []);

  // ── Filtered nearby list ──────────────────────────────────────────────────
  const filteredNearby = (nearby ?? []).filter(
    s => browseFilter === 'all' || s.pillar === browseFilter
  );

  // ── Shared: tab bar ───────────────────────────────────────────────────────
  const tabBar = (
    <div className="flex-shrink-0 flex gap-1 px-4 pt-3 pb-2"
      style={{ background: '#0A1E2E', borderBottom: '1px solid rgba(56,174,210,0.12)' }}>
      {([['route','My Route','🗺'], ['browse','All Nearby','🔍']] as const).map(([t, label, icon]) => (
        <button
          key={t}
          onClick={() => setTab(t)}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-1.5"
          style={{
            background: tab === t ? 'rgba(26,147,187,0.22)' : 'rgba(255,255,255,0.04)',
            border:     tab === t ? '1px solid rgba(56,174,210,0.5)' : '1px solid rgba(255,255,255,0.07)',
            color:      tab === t ? '#72C8E2' : 'rgba(255,255,255,0.45)',
          }}>
          {icon} {label}
        </button>
      ))}
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // ROUTE TAB
  // ─────────────────────────────────────────────────────────────────────────
  if (tab === 'route') {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: '#071520' }}>

        {/* ── Map ── */}
        <div className="relative flex-shrink-0" style={{ height: '38vh', minHeight: 240 }}>
          {isSpeaking && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] flex items-center gap-2 px-4 py-2 rounded-full"
              style={{ background: 'rgba(7,21,32,0.88)', backdropFilter: 'blur(8px)', border: '1px solid rgba(56,174,210,0.35)' }}>
              {[0,1,2,3,4].map(i => (
                <div key={i} className="w-1 rounded-full animate-wave"
                  style={{ height: 16, background: '#38AED2', opacity: 0.8, animationDelay: `${i * 0.12}s` }} />
              ))}
              <span className="text-xs font-light ml-1.5" style={{ color: '#72C8E2' }}>Speaking your route…</span>
            </div>
          )}
          <div className="absolute bottom-3 left-3 z-[500] flex items-center gap-1.5 px-2.5 py-1.5 rounded-full"
            style={{ background: 'rgba(7,21,32,0.82)', backdropFilter: 'blur(6px)', border: '1px solid rgba(56,174,210,0.25)' }}>
            <div className="w-2 h-2 rounded-full" style={{ background: '#38AED2', boxShadow: '0 0 6px rgba(56,174,210,0.7)' }} />
            <span className="text-xs font-medium" style={{ color: 'rgba(114,200,226,0.85)' }}>📍 {hubName}</span>
          </div>
          {stops.length > 0 && (
            <div className="absolute bottom-3 right-3 z-[500] flex items-center gap-2.5 px-3 py-1.5 rounded-full"
              style={{ background: 'rgba(7,21,32,0.82)', backdropFilter: 'blur(6px)', border: '1px solid rgba(56,174,210,0.25)' }}>
              {stops.map(({ pillar }, i) => (
                <div key={pillar} className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full" style={{ background: pColor(pillar) }} />
                  <span className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>{i + 1} {pillar}</span>
                </div>
              ))}
            </div>
          )}
          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
        </div>

        {tabBar}

        {/* ── Stop cards ── */}
        <div className="flex-1 overflow-y-auto px-4 pt-3 pb-6 space-y-3"
          style={{ background: 'linear-gradient(160deg, #0A1E2E 0%, #0D2436 60%, #061825 100%)' }}>

          {stops.map(({ pillar, result }, i) => {
            const accent = pColor(pillar);
            return (
              <div key={i} className="rounded-2xl overflow-hidden"
                style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${accent}44`, boxShadow: '0 4px 24px rgba(0,0,0,0.35)' }}>

                <div className="px-5 py-2.5 flex items-center justify-between"
                  style={{ background: `${accent}1A`, borderBottom: `1px solid ${accent}30` }}>
                  <div className="flex items-center gap-2.5">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                      style={{ background: accent }}>{i + 1}</div>
                    <span className="text-xs font-bold uppercase tracking-widest" style={{ color: accent }}>
                      {pIcon(pillar)} {pillar}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {result.transit_accessible && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ background: 'rgba(58,138,113,0.2)', color: '#80C0AA' }}>🚌 TTC</span>
                    )}
                    {result.open_now === false && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ background: 'rgba(217,119,6,0.2)', color: '#FBBF24' }}>Closed</span>
                    )}
                    {result.open_now !== false && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ background: 'rgba(58,138,113,0.2)', color: '#80C0AA' }}>● Open</span>
                    )}
                  </div>
                </div>

                <div className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-2xl font-semibold leading-tight" style={{ color: 'rgba(255,255,255,0.95)' }}>{result.name}</p>
                      <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.38)' }}>{result.address}</p>
                    </div>
                    <div className="flex-shrink-0 text-right pl-2">
                      <div className="text-5xl font-bold leading-none tabular-nums" style={{ color: accent }}>{result.distance_walk_min}</div>
                      <div className="text-xs font-semibold mt-0.5 uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.38)' }}>min walk</div>
                      <div className="text-sm font-medium mt-1" style={{ color: 'rgba(255,255,255,0.28)' }}>{result.distance_km.toFixed(1)} km</div>
                    </div>
                  </div>

                  {result.intake_preparation && (
                    <p className="mt-3 text-sm leading-relaxed px-3 py-2.5 rounded-xl"
                      style={{ background: 'rgba(56,174,210,0.07)', color: '#AADEED', borderLeft: `3px solid ${accent}55` }}>
                      When you arrive: {result.intake_preparation}
                    </p>
                  )}

                  <div className="mt-3 flex items-center gap-3 flex-wrap">
                    {result.phone && (
                      <span className="text-sm" style={{ color: 'rgba(255,255,255,0.32)' }}>📞 {result.phone}</span>
                    )}
                    <a
                      href={directionsUrl(result.lat, result.lon)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg transition-all"
                      style={{ background: `${accent}22`, color: accent, border: `1px solid ${accent}44` }}
                      onClick={e => e.stopPropagation()}>
                      🧭 Walking directions
                    </a>
                  </div>
                </div>
              </div>
            );
          })}

          {stops.length === 0 && (
            <div className="text-center py-16">
              <p className="text-2xl font-light" style={{ color: 'rgba(255,255,255,0.45)' }}>No resources found nearby.</p>
              <p className="text-xl mt-2" style={{ color: 'rgba(255,255,255,0.28)' }}>Please call 211 for help.</p>
            </div>
          )}

          {/* Action buttons — always rendered so user can skip TTS or start over at any point */}
          {(() => {
            const reserveStop = stops.find(s => s.pillar === 'shelter') ?? stops[0];
            return (
              <div className="flex flex-col gap-3 mt-2">
                {isSpeaking ? (
                  /* During TTS: show a dimmed skip button so user can interrupt immediately */
                  <button
                    onClick={onReset}
                    className="w-full py-4 rounded-2xl text-base font-light transition-all"
                    style={{ color: 'rgba(114,200,226,0.35)', border: '1px solid rgba(26,147,187,0.12)', background: 'rgba(26,147,187,0.03)' }}>
                    Skip &amp; start over
                  </button>
                ) : (
                  <>
                    {reserveStop && onReserve && (
                      <button
                        onClick={() => onReserve(reserveStop.result, reserveStop.pillar)}
                        className="w-full py-5 rounded-2xl text-xl font-semibold transition-all"
                        style={{ background: 'linear-gradient(135deg, #1A7A9A, #38AED2)', color: 'white', boxShadow: '0 4px 24px rgba(26,147,187,0.35)' }}>
                        Reserve a spot at {reserveStop.result.name}
                      </button>
                    )}
                    <button
                      onClick={onReset}
                      className="w-full py-4 rounded-2xl text-base font-light transition-all"
                      style={{ color: 'rgba(114,200,226,0.45)', border: '1px solid rgba(26,147,187,0.18)', background: 'rgba(26,147,187,0.04)' }}>
                      Tap to start again
                    </button>
                  </>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BROWSE NEARBY TAB
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#071520' }}>

      {/* Header strip */}
      <div className="flex-shrink-0 px-4 pt-4 pb-1" style={{ background: '#0A1E2E' }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-xl font-semibold" style={{ color: 'rgba(255,255,255,0.9)' }}>Services near you</h2>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
              {nearbyLoading ? 'Loading…' : `${filteredNearby.length} within 2 km of ${hubName}`}
            </p>
          </div>
          <div className="text-xs px-3 py-1.5 rounded-full font-medium"
            style={{ background: 'rgba(26,147,187,0.15)', color: '#72C8E2', border: '1px solid rgba(56,174,210,0.3)' }}>
            2 km radius
          </div>
        </div>
      </div>

      {tabBar}

      {/* Category filter chips */}
      <div className="flex-shrink-0 flex gap-2 px-4 py-2.5 overflow-x-auto"
        style={{ background: '#0A1E2E', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {(['all', ...ALL_BROWSE_PILLARS] as const).map(p => {
          const active = browseFilter === p;
          const color  = p === 'all' ? '#38AED2' : pColor(p);
          const count  = p === 'all' ? (nearby?.length ?? 0) : (nearby ?? []).filter(s => s.pillar === p).length;
          return (
            <button
              key={p}
              onClick={() => setBrowseFilter(p)}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
              style={{
                background: active ? `${color}22` : 'rgba(255,255,255,0.05)',
                border:     active ? `1px solid ${color}66` : '1px solid rgba(255,255,255,0.08)',
                color:      active ? color : 'rgba(255,255,255,0.45)',
              }}>
              {p === 'all' ? '🔍' : pIcon(p)} {p === 'all' ? 'All' : p}
              {count > 0 && (
                <span className="text-xs rounded-full px-1.5 py-0.5 leading-none"
                  style={{ background: active ? `${color}30` : 'rgba(255,255,255,0.08)', color: active ? color : 'rgba(255,255,255,0.3)' }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Service list */}
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-6 space-y-2.5"
        style={{ background: 'linear-gradient(160deg, #0A1E2E 0%, #0D2436 60%, #061825 100%)' }}>

        {nearbyLoading && (
          <div className="flex flex-col items-center gap-3 py-16">
            <div className="flex items-center gap-1.5">
              {[0,1,2,3,4].map(i => (
                <div key={i} className="w-1.5 rounded-full animate-wave"
                  style={{ height: 20, background: '#38AED2', opacity: 0.7, animationDelay: `${i * 0.12}s` }} />
              ))}
            </div>
            <p className="text-base font-light" style={{ color: 'rgba(114,200,226,0.7)' }}>Finding services nearby…</p>
          </div>
        )}

        {!nearbyLoading && nearbyError && (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <p className="text-xl font-light" style={{ color: 'rgba(255,255,255,0.5)' }}>
              Couldn't load nearby services.
            </p>
            <p className="text-base" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Call <span style={{ color: '#72C8E2', fontWeight: 600 }}>211</span> for real-time help finding resources.
            </p>
            <button
              onClick={() => { setNearbyError(false); setNearby(null); }}
              className="mt-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={{
                background: 'rgba(26,147,187,0.15)',
                border: '1px solid rgba(56,174,210,0.35)',
                color: '#72C8E2',
              }}>
              Try again
            </button>
          </div>
        )}

        {!nearbyLoading && !nearbyError && filteredNearby.length === 0 && nearby !== null && (
          <div className="text-center py-16">
            <p className="text-xl font-light" style={{ color: 'rgba(255,255,255,0.4)' }}>
              No {browseFilter === 'all' ? '' : browseFilter + ' '}services found within 2 km.
            </p>
          </div>
        )}

        {!nearbyLoading && filteredNearby.map((svc, i) => {
          const accent = pColor(svc.pillar);
          return (
            <div key={i} className="rounded-2xl overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${accent}33` }}>

              {/* Top row: category + distance */}
              <div className="px-4 py-2 flex items-center justify-between"
                style={{ background: `${accent}12`, borderBottom: `1px solid ${accent}22` }}>
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: '0.9rem' }}>{pIcon(svc.pillar)}</span>
                  <span className="text-xs font-bold uppercase tracking-widest" style={{ color: accent }}>{svc.pillar}</span>
                  {svc.requires_id && (
                    <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                      style={{ background: 'rgba(251,191,36,0.15)', color: '#FBBF24' }}>ID req.</span>
                  )}
                  {!svc.harm_reduction && (
                    <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                      style={{ background: 'rgba(239,68,68,0.12)', color: '#F87171' }}>sober only</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold tabular-nums" style={{ color: accent }}>{svc.distance_walk_min}</span>
                  <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>min</span>
                </div>
              </div>

              <div className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold leading-snug" style={{ color: 'rgba(255,255,255,0.92)' }}>{svc.name}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>{svc.address}</p>
                    {svc.hours && (
                      <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.28)' }}>🕐 {svc.hours}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                  {svc.phone && (
                    <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>📞 {svc.phone}</span>
                  )}
                  <a
                    href={directionsUrl(svc.lat, svc.lon)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-all"
                    style={{ background: `${accent}1A`, color: accent, border: `1px solid ${accent}35` }}
                    onClick={e => e.stopPropagation()}>
                    🧭 Directions
                  </a>
                  {svc.bypass_pathway && (
                    <span className="text-xs italic" style={{ color: 'rgba(255,255,255,0.25)' }}>{svc.bypass_pathway}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Footer — always visible */}
        <button
          onClick={onReset}
          className="w-full mt-4 py-4 rounded-2xl text-base font-light transition-all"
          style={{ color: 'rgba(114,200,226,0.45)', border: '1px solid rgba(26,147,187,0.18)', background: 'rgba(26,147,187,0.04)' }}>
          {isSpeaking ? 'Skip & start over' : 'Tap to start again'}
        </button>
      </div>
    </div>
  );
}
