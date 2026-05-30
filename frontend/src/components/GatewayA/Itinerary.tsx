import type { Itinerary as ItineraryType, ItineraryResult } from '../../types/api';

interface Props {
  itinerary:  ItineraryType;
  onHandoff?: (result: ItineraryResult) => void;
}

const PILLAR_STYLES: Record<string, { badge: string; border: string; dot: string }> = {
  shelter:  { badge: 'background:#FAD9DE;color:#5E1220',  border: '#F4B0BB', dot: '#C23B52' },
  rehab:    { badge: 'background:#F4E8FA;color:#4A1560',  border: '#DDB8F0', dot: '#9333EA' },
  food:     { badge: 'background:#D1FADF;color:#065F46',  border: '#6EE7B7', dot: '#10B981' },
  hygiene:  { badge: 'background:#FAEFD4;color:#713F12',  border: '#FCD34D', dot: '#D97706' },
  supplies: { badge: 'background:#FAE3D5;color:#7A3A17',  border: '#FDBA74', dot: '#B44A1F' },
};

function OccupancyBar({ ratio }: { ratio: number }) {
  const pct   = Math.min(100, Math.round(ratio * 100));
  const color = pct < 70 ? '#10B981' : pct < 90 ? '#D97706' : '#C23B52';
  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="flex-1 rounded-full h-1.5" style={{ background: '#EDD5CC' }}>
        <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs font-medium" style={{ color: '#7A5C54', minWidth: 52 }}>{pct}% full</span>
    </div>
  );
}

function ResultCard({ result, onHandoff }: { result: ItineraryResult; onHandoff?: () => void }) {
  const style = PILLAR_STYLES[result.pillar] ?? { badge: 'background:#FAD9DE;color:#5E1220', border: '#EDD5CC', dot: '#9B2335' };

  return (
    <div className="rounded-xl mb-3 overflow-hidden"
      style={{ background: 'white', border: `1px solid ${style.border}`, boxShadow: '0 1px 4px rgba(61,11,21,0.08)' }}>

      {/* Top strip */}
      <div className="flex items-center justify-between px-4 py-2.5"
        style={{ background: `${style.badge.split(';')[0].replace('background:', '')}22`, borderBottom: `1px solid ${style.border}` }}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: style.dot }} />
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: style.dot }}>
            {result.pillar}
          </span>
        </div>
        {result.transit_accessible && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={{ background: '#D1FADF', color: '#065F46' }}>
            🚌 TTC
          </span>
        )}
      </div>

      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold text-sm leading-snug" style={{ color: '#2C1518' }}>{result.name}</div>
            <div className="text-xs mt-0.5 truncate" style={{ color: '#7A5C54' }}>{result.address}</div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-sm font-bold" style={{ color: '#9B2335' }}>{result.distance_walk_min} min</div>
            <div className="text-xs" style={{ color: '#A67F72' }}>{result.distance_km} km</div>
          </div>
        </div>

        <OccupancyBar ratio={result.occupancy_ratio} />

        <div className="flex flex-wrap gap-3 mt-2 text-xs" style={{ color: '#7A5C54' }}>
          {result.phone && <span>📞 {result.phone}</span>}
          {result.hours && <span>🕐 {result.hours}</span>}
        </div>

        {result.intake_preparation && (
          <div className="mt-2 text-xs rounded-lg px-3 py-2 leading-relaxed"
            style={{ background: '#FAEFD4', color: '#713F12', border: '1px solid #FCD34D' }}>
            <span className="font-semibold">On arrival: </span>{result.intake_preparation}
          </div>
        )}

        {result.bypass_pathway && (
          <div className="mt-1.5 text-xs rounded-lg px-3 py-2 leading-relaxed"
            style={{ background: '#FAE3D5', color: '#7A3A17', border: '1px solid #FDBA74' }}>
            <span className="font-semibold">If turned away: </span>{result.bypass_pathway}
          </div>
        )}

        {onHandoff && (
          <button
            onClick={onHandoff}
            className="mt-3 text-xs font-semibold flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all"
            style={{ background: '#FAD9DE', color: '#7D1A2A', border: '1px solid #F4B0BB' }}
          >
            📞 Generate phone script →
          </button>
        )}
      </div>
    </div>
  );
}

export function ItineraryView({ itinerary, onHandoff }: Props) {
  const pillars = Object.entries(itinerary).filter(([, results]) => results.length > 0);

  if (pillars.length === 0) {
    return (
      <div className="text-center py-12 rounded-2xl"
        style={{ background: 'white', border: '1px solid #EDD5CC' }}>
        <div className="text-4xl mb-3">🗺</div>
        <div className="font-semibold" style={{ color: '#5C3A40' }}>No resources found nearby</div>
        <div className="text-sm mt-1" style={{ color: '#A67F72' }}>Try calling 211 for additional options.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="h-px flex-1" style={{ background: 'linear-gradient(90deg, #C23B52, transparent)' }} />
        <h3 className="text-sm font-bold uppercase tracking-widest" style={{ color: '#7D1A2A' }}>Care Route</h3>
        <div className="h-px flex-1" style={{ background: 'linear-gradient(90deg, transparent, #C23B52)' }} />
      </div>

      {pillars.map(([pillar, results]) => (
        <div key={pillar} className="mb-4">
          {results.map((r, i) => (
            <ResultCard
              key={i}
              result={r}
              onHandoff={i === 0 && onHandoff ? () => onHandoff(r) : undefined}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
