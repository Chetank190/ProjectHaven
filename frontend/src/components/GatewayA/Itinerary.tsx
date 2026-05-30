import type { Itinerary as ItineraryType, ItineraryResult } from '../../types/api';

interface Props {
  itinerary:  ItineraryType;
  onHandoff?: (result: ItineraryResult) => void;
}

const PILLAR_COLORS: Record<string, string> = {
  shelter:  'bg-blue-100 text-blue-800',
  rehab:    'bg-purple-100 text-purple-800',
  food:     'bg-green-100 text-green-800',
  hygiene:  'bg-teal-100 text-teal-800',
  supplies: 'bg-orange-100 text-orange-800',
};

function OccupancyBar({ ratio }: { ratio: number }) {
  const pct = Math.min(100, Math.round(ratio * 100));
  const color = pct < 70 ? 'bg-green-500' : pct < 90 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 bg-gray-200 rounded-full h-2">
        <div className={`${color} h-2 rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500">{pct}% full</span>
    </div>
  );
}

function ResultCard({ result, onHandoff }: { result: ItineraryResult; onHandoff?: () => void }) {
  return (
    <div className="border border-gray-200 rounded-xl p-4 mb-3 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-gray-900">{result.name}</div>
          <div className="text-sm text-gray-500">{result.address}</div>
        </div>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${PILLAR_COLORS[result.pillar] || 'bg-gray-100 text-gray-600'}`}>
          {result.pillar}
        </span>
      </div>

      <OccupancyBar ratio={result.occupancy_ratio} />

      <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
        <span>🚶 {result.distance_walk_min} min walk</span>
        {result.transit_accessible && <span>🚌 TTC nearby</span>}
        {result.phone && <span>📞 {result.phone}</span>}
        {result.hours && <span>🕐 {result.hours}</span>}
      </div>

      {result.intake_preparation && (
        <div className="mt-2 text-xs bg-blue-50 text-blue-800 rounded-lg p-2">
          <span className="font-semibold">On arrival: </span>{result.intake_preparation}
        </div>
      )}

      {result.bypass_pathway && (
        <div className="mt-1 text-xs bg-amber-50 text-amber-800 rounded-lg p-2">
          <span className="font-semibold">If turned away: </span>{result.bypass_pathway}
        </div>
      )}

      {onHandoff && (
        <button
          onClick={onHandoff}
          className="mt-2 text-xs text-blue-600 hover:underline"
        >
          Generate phone script →
        </button>
      )}
    </div>
  );
}

export function ItineraryView({ itinerary, onHandoff }: Props) {
  const pillars = Object.entries(itinerary).filter(([, results]) => results.length > 0);

  if (pillars.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">
        No resources found for the current needs and location.
        <br />
        <span className="text-sm">Try calling 211 for additional options.</span>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-800 mb-3">Care Route</h3>
      {pillars.map(([pillar, results]) => (
        <div key={pillar} className="mb-4">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-2 capitalize">
            {pillar}
          </h4>
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
