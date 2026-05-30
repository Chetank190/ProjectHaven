import { useEffect } from 'react';
import { useSpeech }  from '../shared/useSpeech';
import type { Itinerary } from '../../types/api';

interface Props {
  itinerary:  Itinerary;
  ttsScript:  string;
  onReset:    () => void;
}

export function KioskItinerary({ itinerary, ttsScript, onReset }: Props) {
  const { speak, isSpeaking } = useSpeech();

  // Speak the route immediately on mount
  useEffect(() => {
    speak(ttsScript);
    return () => window.speechSynthesis.cancel();
  }, []);

  const stops = Object.entries(itinerary)
    .filter(([, results]) => results.length > 0)
    .map(([pillar, results]) => ({ pillar, result: results[0] }));

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-950 text-white px-6 py-8">
      <h2 className="text-3xl font-light mb-8 text-green-400">
        {isSpeaking ? 'Speaking your route…' : 'Your Route'}
      </h2>

      <div className="w-full max-w-xl space-y-4">
        {stops.map(({ pillar, result }, i) => (
          <div key={i} className="bg-gray-800 rounded-2xl p-5 border border-gray-700">
            <div className="flex items-start justify-between mb-1">
              <div>
                <p className="text-2xl font-semibold">{result.name}</p>
                <p className="text-gray-400 text-lg">{result.address}</p>
              </div>
              <span className="text-sm font-medium bg-green-800 text-green-300 px-3 py-1 rounded-full capitalize">
                {pillar}
              </span>
            </div>

            <div className="mt-3 flex gap-4 text-gray-300 text-lg">
              <span>🚶 {result.distance_walk_min} min walk</span>
              {result.transit_accessible && <span>🚌 TTC nearby</span>}
            </div>

            {result.intake_preparation && (
              <p className="mt-3 text-lg text-blue-300 leading-relaxed">
                When you arrive: {result.intake_preparation}
              </p>
            )}

            {result.phone && (
              <p className="mt-1 text-lg text-gray-400">📞 {result.phone}</p>
            )}
          </div>
        ))}

        {stops.length === 0 && (
          <p className="text-2xl text-gray-400 text-center">
            No resources found nearby. Please call 211 for help.
          </p>
        )}
      </div>

      {!isSpeaking && (
        <button
          onClick={onReset}
          className="mt-12 text-2xl font-light text-gray-400 border border-gray-600 rounded-2xl px-8 py-4 hover:bg-gray-800 transition"
        >
          Press and hold to start again
        </button>
      )}
    </div>
  );
}
