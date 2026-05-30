import type { Itinerary as ItineraryType, ItineraryResult } from '../../types/api';

interface Props {
  itinerary:  ItineraryType;
  onHandoff?: (result: ItineraryResult) => void;
}

// Calming, accessible colors — no red for distressed users
const PILLAR_STYLES: Record<string, { accent: string; bg: string; border: string }> = {
  shelter:  { accent: '#1A7A9A', bg: '#EFF9FB', border: '#AADEED' },
  rehab:    { accent: '#3A8A71', bg: '#F0F7F4', border: '#B4DBCD' },
  food:     { accent: '#D97706', bg: '#FFFBEB', border: '#FDE68A' },
  hygiene:  { accent: '#506170', bg: '#F5F7F8', border: '#D0D8DE' },
  supplies: { accent: '#0F4259', bg: '#D5EFF5', border: '#72C8E2' },
};

function OccupancyBar({ ratio }: { ratio: number }) {
  const pct   = Math.min(100, Math.round(ratio * 100));
  const color = pct < 70 ? '#3A8A71' : pct < 90 ? '#D97706' : '#1A7A9A';
  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="flex-1 rounded-full h-1.5" style={{ background: '#E9EDF0' }}>
        <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs font-medium" style={{ color: '#677D8E', minWidth: 52 }}>{pct}% full</span>
    </div>
  );
}

function ResultCard({ result, onHandoff }: { result: ItineraryResult; onHandoff?: () => void }) {
  const s = PILLAR_STYLES[result.pillar] ?? PILLAR_STYLES.hygiene;

  return (
    <div className="rounded-xl mb-3 overflow-hidden"
      style={{ background: 'white', border: `1px solid ${s.border}`, boxShadow: '0 1px 4px rgba(10,42,61,0.06)' }}>

      {/* Pillar strip */}
      <div className="flex items-center justify-between px-4 py-2"
        style={{ background: s.bg, borderBottom: `1px solid ${s.border}` }}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: s.accent }} />
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: s.accent }}>
            {result.pillar}
          </span>
        </div>
        {result.transit_accessible && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={{ background: '#D9EDE6', color: '#1D4238' }}>
            🚌 TTC
          </span>
        )}
      </div>

      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold text-sm" style={{ color: '#1A2330' }}>{result.name}</div>
            <div className="text-xs mt-0.5 truncate" style={{ color: '#677D8E' }}>{result.address}</div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-sm font-bold" style={{ color: s.accent }}>{result.distance_walk_min} min</div>
            <div className="text-xs" style={{ color: '#8A9BAA' }}>{result.distance_km} km</div>
          </div>
        </div>

        <OccupancyBar ratio={result.occupancy_ratio} />

        <div className="flex flex-wrap gap-3 mt-2 text-xs" style={{ color: '#677D8E' }}>
          {result.phone && <span>📞 {result.phone}</span>}
          {result.hours && <span>🕐 {result.hours}</span>}
        </div>

        {result.intake_preparation && (
          <div className="mt-2 text-xs rounded-lg px-3 py-2 leading-relaxed"
            style={{ background: '#EFF9FB', color: '#0F4259', border: '1px solid #AADEED' }}>
            <span className="font-semibold">On arrival: </span>{result.intake_preparation}
          </div>
        )}

        {result.bypass_pathway && (
          <div className="mt-1.5 text-xs rounded-lg px-3 py-2 leading-relaxed"
            style={{ background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A' }}>
            <span className="font-semibold">If turned away: </span>{result.bypass_pathway}
          </div>
        )}

        {onHandoff && (
          <button
            onClick={onHandoff}
            className="mt-3 text-xs font-semibold flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all"
            style={{ background: s.bg, color: s.accent, border: `1px solid ${s.border}` }}
          >
            📞 Generate phone script →
          </button>
        )}
      </div>
    </div>
  );
}

export function ItineraryView({ itinerary, onHandoff }: Props) {
  const pillars = Object.entries(itinerary).filter(([, r]) => r.length > 0);

  if (pillars.length === 0) {
    return (
      <div className="text-center py-12 rounded-2xl" style={{ background: 'white', border: '1px solid #D0D8DE' }}>
        <div className="text-4xl mb-3">🗺</div>
        <div className="font-semibold" style={{ color: '#3D4D59' }}>No resources found nearby</div>
        <div className="text-sm mt-1" style={{ color: '#8A9BAA' }}>Try calling 211 for additional options.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <div className="h-px flex-1" style={{ background: 'linear-gradient(90deg, #1A7A9A, transparent)' }} />
        <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#1A7A9A' }}>Care Route</h3>
        <div className="h-px flex-1" style={{ background: 'linear-gradient(90deg, transparent, #1A7A9A)' }} />
      </div>
      {pillars.map(([pillar, results]) => (
        <div key={pillar}>
          {results.map((r, i) => (
            <ResultCard
              key={`${pillar}-${r.name}-${i}`}
              result={r}
              onHandoff={i === 0 && onHandoff ? () => onHandoff(r) : undefined}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
