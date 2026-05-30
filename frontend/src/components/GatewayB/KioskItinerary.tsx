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

  const PILLAR_COLORS: Record<string, string> = {
    shelter:  '#C23B52',
    rehab:    '#9333EA',
    food:     '#10B981',
    hygiene:  '#D97706',
    supplies: '#B44A1F',
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-10"
      style={{ background: 'linear-gradient(160deg, #160B0F 0%, #1A0E10 50%, #231316 100%)' }}>

      {/* Title */}
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-light tracking-wide"
          style={{ color: isSpeaking ? '#EDC36C' : 'rgba(255,255,255,0.9)' }}>
          {isSpeaking ? (
            <span className="flex items-center gap-3 justify-center">
              <span className="flex gap-1">
                {[0,1,2].map(i => (
                  <span key={i} className="inline-block w-1.5 rounded-full animate-bounce"
                    style={{ height: 24, background: '#EDC36C', animationDelay: `${i * 0.1}s` }} />
                ))}
              </span>
              Speaking your route…
            </span>
          ) : 'Your Route'}
        </h2>
      </div>

      <div className="w-full max-w-lg space-y-4">
        {stops.map(({ pillar, result }, i) => {
          const accentColor = PILLAR_COLORS[pillar] ?? '#B87333';
          return (
            <div
              key={i}
              className="rounded-2xl overflow-hidden"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: `1px solid ${accentColor}44`,
                boxShadow: `0 4px 20px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)`,
              }}
            >
              {/* Pillar strip */}
              <div className="px-5 py-2 flex items-center justify-between"
                style={{ background: `${accentColor}22`, borderBottom: `1px solid ${accentColor}33` }}>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: accentColor }} />
                  <span className="text-xs font-bold uppercase tracking-widest" style={{ color: accentColor }}>
                    {pillar}
                  </span>
                </div>
                {result.transit_accessible && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: 'rgba(16,185,129,0.2)', color: '#6EE7B7' }}>
                    🚌 TTC
                  </span>
                )}
              </div>

              <div className="px-5 py-4">
                <p className="text-2xl font-semibold leading-tight" style={{ color: 'white' }}>
                  {result.name}
                </p>
                <p className="text-base mt-1" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  {result.address}
                </p>

                <div className="flex gap-4 mt-3 text-lg font-light" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  <span>🚶 {result.distance_walk_min} min walk</span>
                </div>

                {result.intake_preparation && (
                  <p className="mt-3 text-base leading-relaxed" style={{ color: '#FAEFD4' }}>
                    When you arrive: {result.intake_preparation}
                  </p>
                )}

                {result.phone && (
                  <p className="mt-2 text-lg" style={{ color: 'rgba(255,255,255,0.5)' }}>
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
            <p className="text-xl mt-2" style={{ color: 'rgba(255,255,255,0.35)' }}>
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
            color: 'rgba(212,165,58,0.7)',
            border: '1px solid rgba(184,115,51,0.3)',
            background: 'rgba(184,115,51,0.08)',
          }}
        >
          Hold the orb to start again
        </button>
      )}
    </div>
  );
}
