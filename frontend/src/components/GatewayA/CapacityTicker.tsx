import { useEffect, useState } from 'react';
import api from '../../api/client';

interface Capacity {
  total_beds:     number;
  available_beds: number;
  occupied_beds:  number;
  occupancy_pct:  number;
}

export function CapacityTicker() {
  const [data,    setData]    = useState<Capacity | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);

  const fetch = () => {
    api.get<Capacity>('/capacity')
      .then(r => { setData(r.data); setUpdated(new Date()); })
      .catch(() => {});    // silently skip if backend isn't up yet
  };

  useEffect(() => {
    fetch();
    const t = setInterval(fetch, 60_000);
    return () => clearInterval(t);
  }, []);

  if (!data) return null;

  const pct  = data.occupancy_pct;
  const barColor = pct >= 97 ? '#EF4444' : pct >= 93 ? '#D97706' : '#3A8A71';
  const textColor = pct >= 97 ? '#FCA5A5' : pct >= 93 ? '#FDE68A' : '#6EE7B7';
  const label = pct >= 97 ? 'Critical' : pct >= 93 ? 'High pressure' : 'Normal';

  return (
    <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg"
      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>

      {/* Animated pulse dot */}
      <span className="relative flex h-2 w-2 flex-shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
          style={{ background: barColor }} />
        <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: barColor }} />
      </span>

      <div className="flex flex-col gap-0.5">
        {/* Occupancy bar */}
        <div className="flex items-center gap-1.5">
          <div className="w-20 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
            <div className="h-1 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, pct)}%`, background: barColor }} />
          </div>
          <span className="text-xs font-bold tabular-nums" style={{ color: textColor }}>
            {pct.toFixed(1)}%
          </span>
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>|</span>
          <span className="text-xs font-medium" style={{ color: textColor }}>{label}</span>
        </div>

        <div className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
          {data.available_beds} beds free · {updated?.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}
