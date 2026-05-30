import { useEffect } from 'react';
import { useSpeech }  from '../shared/useSpeech';
import type { Itinerary } from '../../types/api';

interface Props {
  itinerary: Itinerary;
  ttsScript: string;
  onReset:   () => void;
}

export function KioskItinerary({ itinerary, ttsScript, onReset }: Props) {
  const { speak, isSpeaking } = useSpeech();

  useEffect(() => {
    speak(ttsScript);
    return () => window.speechSynthesis.cancel();
  }, []);

  const stops = Object.entries(itinerary)
    .filter(([, results]) => results.length > 0)
    .map(([pillar, results]) => ({ pillar, result: results[0] }));

  // Calming, non-alarming pillar colors
  const PILLAR_ACCENT: Record<string, string> = {
    shelter:  '#1A7A9A',
    rehab:    '#3A8A71',
    food:     '#D97706',
    hygiene:  '#506170',
    supplies: '#38AED2',
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-10"
      style={{ background: 'linear-gradient(160deg, #0A1E2E 0%, #0D2436 50%, #0F2A3A 100%)' }}>

      {/* Header */}
      <div className="mb-8 text-center">
        {isSpeaking ? (
          <div className="flex flex-col items-center gap-3">
            {/* Subtle audio wave — calm, not alarming */}
            <div className="flex items-center gap-1.5 h-8">
              {[0,1,2,3,4].map(i => (
                <div key={i} className="w-1.5 rounded-full animate-wave"
                  style={{
                    height: 24,
                    background: '#38AED2',
                    opacity: 0.7,
                    animationDelay: `${i * 0.12}s`,
                  }} />
              ))}
            </div>
            <h2 className="text-3xl font-light tracking-wide" style={{ color: 'rgba(114,200,226,0.9)' }}>
              Speaking your route…
            </h2>
          </div>
        ) : (
          <h2 className="text-3xl font-light tracking-wide" style={{ color: 'rgba(255,255,255,0.9)' }}>
            Your Route
          </h2>
        )}
      </div>

      <div className="w-full max-w-lg space-y-4">
        {stops.map(({ pillar, result }, i) => {
          const accent = PILLAR_ACCENT[pillar] ?? '#38AED2';
          return (
            <div key={i} className="rounded-2xl overflow-hidden"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: `1px solid ${accent}44`,
                boxShadow: `0 4px 20px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)`,
              }}>

              {/* Pillar label strip */}
              <div className="px-5 py-2 flex items-center justify-between"
                style={{ background: `${accent}18`, borderBottom: `1px solid ${accent}33` }}>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: accent }} />
                  <span className="text-xs font-bold uppercase tracking-widest" style={{ color: accent }}>
                    {pillar}
                  </span>
                </div>
                {result.transit_accessible && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: 'rgba(58,138,113,0.2)', color: '#80C0AA' }}>
                    🚌 TTC nearby
                  </span>
                )}
              </div>

              <div className="px-5 py-4">
                <p className="text-2xl font-semibold" style={{ color: 'rgba(255,255,255,0.95)' }}>
                  {result.name}
                </p>
                <p className="text-base mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  {result.address}
                </p>
                <p className="text-lg font-light mt-2" style={{ color: 'rgba(255,255,255,0.65)' }}>
                  🚶 {result.distance_walk_min} minute walk
                </p>
                {result.intake_preparation && (
                  <p className="mt-3 text-base leading-relaxed" style={{ color: '#AADEED' }}>
                    When you arrive: {result.intake_preparation}
                  </p>
                )}
                {result.phone && (
                  <p className="mt-2 text-base" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    📞 {result.phone}
                  </p>
                )}
              </div>
            </div>
          );
        })}

        {stops.length === 0 && (
          <div className="text-center py-12">
            <p className="text-2xl font-light" style={{ color: 'rgba(255,255,255,0.5)' }}>
              No resources found nearby.
            </p>
            <p className="text-xl mt-2" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Please call 211 for help.
            </p>
          </div>
        )}
      </div>

      {!isSpeaking && (
        <button
          onClick={onReset}
          className="mt-12 text-xl font-light px-10 py-5 rounded-2xl transition-all"
          style={{
            color: 'rgba(114,200,226,0.6)',
            border: '1px solid rgba(26,147,187,0.25)',
            background: 'rgba(26,147,187,0.06)',
          }}
        >
          Hold the orb to start again
        </button>
      )}
    </div>
  );
}
