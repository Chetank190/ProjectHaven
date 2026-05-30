type OrbState = 'idle' | 'listening' | 'processing' | 'speaking';

interface Props {
  state:         OrbState;
  onPointerDown: () => void;
  onPointerUp:   () => void;
}

const STATE_CONFIG: Record<OrbState, {
  orbBg:   string;
  ringColor: string;
  glowColor: string;
  label:   string;
  pulseColor?: string;
}> = {
  idle: {
    orbBg:    'linear-gradient(135deg, #3D0B15, #7D1A2A)',
    ringColor: 'rgba(184,115,51,0.6)',
    glowColor: 'rgba(125,26,42,0.4)',
    label:    'Hold to speak',
  },
  listening: {
    orbBg:    'linear-gradient(135deg, #7D1A2A, #C23B52)',
    ringColor: 'rgba(194,59,82,0.9)',
    glowColor: 'rgba(194,59,82,0.6)',
    label:    'Listening…',
    pulseColor: 'rgba(194,59,82,0.25)',
  },
  processing: {
    orbBg:    'linear-gradient(135deg, #6A2B11, #B44A1F)',
    ringColor: 'rgba(180,74,31,0.8)',
    glowColor: 'rgba(180,74,31,0.5)',
    label:    'Finding help…',
  },
  speaking: {
    orbBg:    'linear-gradient(135deg, #5A3515, #B87333)',
    ringColor: 'rgba(184,115,51,0.9)',
    glowColor: 'rgba(184,115,51,0.5)',
    label:    "Here's what I found…",
    pulseColor: 'rgba(184,115,51,0.2)',
  },
};

export function VoiceOrb({ state, onPointerDown, onPointerUp }: Props) {
  const cfg = STATE_CONFIG[state];

  return (
    <div
      className="flex flex-col items-center justify-center h-full select-none"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onContextMenu={e => e.preventDefault()}
      style={{ touchAction: 'none' }}
    >
      <div className="relative flex items-center justify-center">

        {/* Outer ambient glow ring (idle + speaking) */}
        {(state === 'idle' || state === 'speaking') && (
          <div
            className="absolute rounded-full animate-pulse-slow"
            style={{
              width: 300, height: 300,
              background: `radial-gradient(circle, ${cfg.glowColor} 0%, transparent 70%)`,
            }}
          />
        )}

        {/* Ping ring (listening) */}
        {state === 'listening' && (
          <>
            <div className="absolute rounded-full animate-ping"
              style={{ width: 280, height: 280, background: cfg.pulseColor }} />
            <div className="absolute rounded-full animate-ping"
              style={{ width: 240, height: 240, background: cfg.pulseColor, animationDelay: '0.3s' }} />
          </>
        )}

        {/* Pulse ring (speaking) */}
        {state === 'speaking' && (
          <div className="absolute rounded-full animate-pulse"
            style={{ width: 260, height: 260, background: cfg.pulseColor }} />
        )}

        {/* The orb itself */}
        <div
          className="relative flex items-center justify-center rounded-full cursor-pointer transition-all duration-500"
          style={{
            width: 220, height: 220,
            background: cfg.orbBg,
            boxShadow: `0 0 40px ${cfg.glowColor}, 0 0 0 3px ${cfg.ringColor}, 0 20px 60px rgba(0,0,0,0.5)`,
          }}
        >
          {/* Inner shimmer */}
          <div className="absolute inset-3 rounded-full opacity-20"
            style={{ background: 'radial-gradient(circle at 35% 35%, rgba(255,255,255,0.4), transparent)' }} />

          {state === 'processing' ? (
            <svg className="w-20 h-20 animate-spin" style={{ color: 'rgba(255,255,255,0.9)' }} fill="none" viewBox="0 0 24 24">
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

      {/* State label */}
      <p className="mt-10 text-2xl font-light text-center px-6 tracking-wide"
        style={{ color: state === 'idle' ? 'rgba(212,165,58,0.7)' : 'rgba(255,255,255,0.9)' }}>
        {cfg.label}
      </p>
    </div>
  );
}
