// Full-screen tap target for kiosk. No text buttons — the orb IS the affordance.
type OrbState = 'idle' | 'listening' | 'processing' | 'speaking';

interface Props {
  state:          OrbState;
  onPointerDown:  () => void;
  onPointerUp:    () => void;
}

const STATE_STYLES: Record<OrbState, { ring: string; bg: string; label: string }> = {
  idle:       { ring: 'ring-gray-500',   bg: 'bg-gray-700',   label: 'Hold to speak' },
  listening:  { ring: 'ring-red-500',    bg: 'bg-red-700',    label: 'Listening…' },
  processing: { ring: 'ring-blue-400',   bg: 'bg-blue-700',   label: 'Finding help…' },
  speaking:   { ring: 'ring-green-400',  bg: 'bg-green-700',  label: "Here's what I found…" },
};

export function VoiceOrb({ state, onPointerDown, onPointerUp }: Props) {
  const { ring, bg, label } = STATE_STYLES[state];
  const pulse = state === 'listening' ? 'animate-ping' : '';

  return (
    <div
      className="flex flex-col items-center justify-center h-full select-none"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onContextMenu={e => e.preventDefault()}
      style={{ touchAction: 'none' }}
    >
      {/* Pulse ring */}
      <div className="relative flex items-center justify-center">
        {state === 'listening' && (
          <div className={`absolute w-64 h-64 rounded-full ${ring.replace('ring-', 'bg-')} opacity-30 animate-ping`} />
        )}
        {state === 'speaking' && (
          <div className={`absolute w-56 h-56 rounded-full ${ring.replace('ring-', 'bg-')} opacity-20 animate-pulse`} />
        )}

        {/* Orb */}
        <div
          className={`
            w-56 h-56 rounded-full flex items-center justify-center
            ${bg} ring-4 ${ring}
            ${state === 'processing' ? 'animate-spin-slow' : ''}
            shadow-2xl cursor-pointer transition-all duration-300
          `}
          style={{ userSelect: 'none' }}
        >
          {state === 'processing' ? (
            <svg className="w-20 h-20 text-white animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : (
            <svg className="w-20 h-20 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.42 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
            </svg>
          )}
        </div>
      </div>

      {/* State label */}
      <p className="mt-8 text-2xl font-light text-white text-center px-4">{label}</p>
    </div>
  );
}
