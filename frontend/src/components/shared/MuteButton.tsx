interface Props {
  muted:      boolean;
  onToggle:   () => void;
  className?: string;
}

// Toggles the shared TTS mute (see useSpeech). tabIndex={-1} so it never steals
// keyboard focus from the VoiceOrb on the kiosk idle screen (AGENTS.md Rule 6).
export function MuteButton({ muted, onToggle, className = '' }: Props) {
  return (
    <button
      tabIndex={-1}
      onClick={onToggle}
      aria-label={muted ? 'Unmute voice' : 'Mute voice'}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-full transition-all ${className}`}
      style={{
        background: muted ? 'rgba(239,68,68,0.15)' : 'rgba(26,147,187,0.10)',
        border:     muted ? '1px solid rgba(239,68,68,0.4)' : '1px solid rgba(56,174,210,0.20)',
        color:      muted ? '#F87171' : 'rgba(114,200,226,0.75)',
        backdropFilter: 'blur(8px)',
      }}>
      <span className="text-sm">{muted ? '🔇' : '🔊'}</span>
      <span className="text-xs font-semibold tracking-wide">{muted ? 'Muted' : 'Voice'}</span>
    </button>
  );
}
