import type { ReactNode } from 'react';
import type { Hospital } from '../../types/api';

interface Props {
  hospitals: Hospital[] | null;   // null = still loading
  // Rendered instead of nothing when the list loads empty (e.g. hospital data
  // unavailable). The crisis screen passes a "go to your nearest ER" line so the
  // emergency screen never shows a blank section.
  emptyFallback?: ReactNode;
}

function directionsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^0-9+]/g, '')}`;
}

function HospitalCard({ h }: { h: Hospital }) {
  const accent = h.emergency ? '#F87171' : '#72C8E2';
  return (
    <div className="rounded-2xl overflow-hidden text-left"
      style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${accent}44` }}>
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-xs font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
                style={{ background: `${accent}22`, color: accent }}>
                {h.emergency ? '24/7 ER' : h.type === 'private' ? 'Private clinic' : 'Urgent care'}
              </span>
            </div>
            <p className="text-lg font-semibold leading-tight" style={{ color: 'rgba(255,255,255,0.95)' }}>
              {h.name}
            </p>
            <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>{h.address}</p>
            {h.note && (
              <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>{h.note}</p>
            )}
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-3xl font-bold leading-none tabular-nums" style={{ color: accent }}>
              {h.distance_drive_min}
            </div>
            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.4)' }}>
              min drive
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.28)' }}>{h.distance_km.toFixed(1)} km</div>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          {h.phone && (
            <a href={telHref(h.phone)}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-xl"
              style={{ background: `${accent}22`, color: accent, border: `1px solid ${accent}44` }}>
              📞 {h.phone}
            </a>
          )}
          <a href={directionsUrl(h.lat, h.lon)} target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-xl"
            style={{ background: 'rgba(56,174,210,0.14)', color: '#72C8E2', border: '1px solid rgba(56,174,210,0.3)' }}>
            🧭 Directions
          </a>
        </div>
      </div>
    </div>
  );
}

export function CrisisHospitals({ hospitals, emptyFallback }: Props) {
  if (hospitals === null) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <div className="flex items-center gap-1.5">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="w-1.5 rounded-full animate-wave"
              style={{ height: 18, background: '#F87171', opacity: 0.7, animationDelay: `${i * 0.12}s` }} />
          ))}
        </div>
        <p className="text-sm font-light" style={{ color: 'rgba(255,255,255,0.5)' }}>Finding the nearest hospitals…</p>
      </div>
    );
  }

  if (hospitals.length === 0) {
    if (!emptyFallback) return null;
    return (
      <div className="w-full max-w-lg mx-auto text-center">
        <p className="text-base font-light" style={{ color: 'rgba(255,255,255,0.7)' }}>{emptyFallback}</p>
      </div>
    );
  }

  const ers      = hospitals.filter(h => h.emergency);
  const clinics  = hospitals.filter(h => !h.emergency);

  return (
    <div className="w-full max-w-lg mx-auto text-left space-y-5">
      {ers.length > 0 && (
        <div>
          <p className="text-sm font-bold uppercase tracking-widest mb-2" style={{ color: 'rgba(248,113,113,0.85)' }}>
            🏥 Nearest emergency rooms
          </p>
          <div className="space-y-2.5">
            {ers.slice(0, 3).map((h, i) => <HospitalCard key={i} h={h} />)}
          </div>
        </div>
      )}

      {clinics.length > 0 && (
        <div>
          <p className="text-sm font-bold uppercase tracking-widest mb-2" style={{ color: 'rgba(114,200,226,0.7)' }}>
            Other clinics nearby
          </p>
          <div className="space-y-2.5">
            {clinics.slice(0, 2).map((h, i) => <HospitalCard key={i} h={h} />)}
          </div>
        </div>
      )}
    </div>
  );
}
