// Kiosk VoiceOrb — calming ocean blues. No red. Designed for people in distress.
type OrbState = 'idle' | 'listening' | 'processing' | 'speaking';

interface Props {
  state:   OrbState;
  onClick: () => void;
}

const STATE_CONFIG: Record<OrbState, {
  orbGradient: string;
  ringColor:   string;
  glowColor:   string;
  glowOuter:   string;
  label:       string;
}> = {
  // Idle: deep, calm navy — stable and trustworthy
  idle: {
    orbGradient: 'linear-gradient(135deg, #0A2A3D 0%, #155F79 60%, #1A7A9A 100%)',
    ringColor:   'rgba(26,147,187,0.5)',
    glowColor:   'rgba(26,147,187,0.15)',
    glowOuter:   'rgba(10,42,61,0.3)',
    label:       'Tap to speak',
  },
  // Listening: brighter, warm blue — attentive and present
  listening: {
    orbGradient: 'linear-gradient(135deg, #1A7A9A 0%, #1A93BB 60%, #38AED2 100%)',
    ringColor:   'rgba(56,174,210,0.8)',
    glowColor:   'rgba(56,174,210,0.3)',
    glowOuter:   'rgba(26,147,187,0.2)',
    label:       'Tap when done',
  },
  // Processing: teal-blue — working, calm
  processing: {
    orbGradient: 'linear-gradient(135deg, #0F4259 0%, #1A7A9A 100%)',
    ringColor:   'rgba(26,147,187,0.7)',
    glowColor:   'rgba(26,122,154,0.25)',
    glowOuter:   'rgba(15,66,89,0.2)',
    label:       'Finding help…',
  },
  // Speaking: sage green — healing, positive, hopeful
  speaking: {
    orbGradient: 'linear-gradient(135deg, #1D4238 0%, #2E6E59 50%, #3A8A71 100%)',
    ringColor:   'rgba(58,138,113,0.8)',
    glowColor:   'rgba(58,138,113,0.3)',
    glowOuter:   'rgba(29,66,56,0.2)',
    label:       "Here's what I found…",
  },
};

export function VoiceOrb({ state, onClick }: Props) {
  const cfg = STATE_CONFIG[state];

  return (
    <div
      className="flex flex-col items-center justify-center h-full select-none"
      onClick={onClick}
      onContextMenu={e => e.preventDefault()}
      style={{ touchAction: 'none' }}
    >
      <div className="relative flex items-center justify-center">

        {/* Soft ambient glow — always present, breathes on idle */}
        <div
          className={`absolute rounded-full ${state === 'idle' ? 'animate-breathe' : 'animate-pulse-gentle'}`}
          style={{
            width: 340, height: 340,
            background: `radial-gradient(circle, ${cfg.glowColor} 0%, ${cfg.glowOuter} 50%, transparent 75%)`,
          }}
        />

        {/* Listening: gentle expanding rings — not alarming, just attentive */}
        {state === 'listening' && (
          <>
            <div className="absolute rounded-full animate-ping"
              style={{ width: 270, height: 270, background: 'rgba(56,174,210,0.12)', animationDuration: '2s' }} />
            <div className="absolute rounded-full animate-ping"
              style={{ width: 240, height: 240, background: 'rgba(56,174,210,0.08)', animationDuration: '2s', animationDelay: '0.5s' }} />
          </>
        )}

        {/* Speaking: gentle sage pulse */}
        {state === 'speaking' && (
          <div className="absolute rounded-full animate-pulse-gentle"
            style={{ width: 265, height: 265, background: 'rgba(58,138,113,0.15)' }} />
        )}

        {/* The orb */}
        <div
          className="relative flex items-center justify-center rounded-full cursor-pointer transition-all duration-700"
          style={{
            width: 220, height: 220,
            background: cfg.orbGradient,
            boxShadow: `0 0 0 2px ${cfg.ringColor}, 0 0 50px ${cfg.glowColor}, 0 24px 64px rgba(0,0,0,0.5)`,
          }}
        >
          {/* Specular highlight */}
          <div className="absolute inset-3 rounded-full opacity-15"
            style={{ background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.6), transparent 60%)' }} />

          {state === 'processing' ? (
            <svg className="w-20 h-20 animate-spin" style={{ color: 'rgba(114,200,226,0.9)' }} fill="none" viewBox="0 0 24 24">
              <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
              <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
          ) : (
            <svg className="w-20 h-20" style={{ color: 'rgba(255,255,255,0.95)', filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.3))' }} fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.42 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>
            </svg>
          )}
        </div>
      </div>

      {/* Label — gentle, never urgent */}
      <p className="mt-10 text-2xl font-light text-center px-6 tracking-wide"
        style={{
          color: state === 'idle'
            ? 'rgba(114,200,226,0.6)'
            : state === 'speaking'
            ? 'rgba(128,192,170,0.9)'
            : 'rgba(255,255,255,0.85)',
        }}>
        {cfg.label}
      </p>
    </div>
  );
}
