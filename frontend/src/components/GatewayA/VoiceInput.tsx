import { useState, useRef } from 'react';

interface Props {
  onSubmit:     (text: string) => void;
  loading:      boolean;
  placeholder?: string;
}

export function VoiceInput({ onSubmit, loading, placeholder = 'Type or speak client notes here…' }: Props) {
  const [text,      setText]      = useState('');
  const [listening, setListening] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const timerRef       = useRef<ReturnType<typeof setInterval> | null>(null);

  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

  const startListening = () => {
    if (!SpeechRecognitionAPI) return;
    const sr = new SpeechRecognitionAPI();
    sr.continuous     = false;
    sr.interimResults = true;
    sr.lang           = 'en-CA';
    sr.onresult = (e: SpeechRecognitionEvent) => {
      const t = Array.from(e.results).map((r: SpeechRecognitionResult) => r[0].transcript).join('');
      setText(t);
    };
    sr.onend = () => { setListening(false); setCountdown(null); };
    sr.start();
    recognitionRef.current = sr;
    setListening(true);
    setCountdown(60);
    timerRef.current = setInterval(() => {
      setCountdown(c => {
        if (c === null || c <= 1) { sr.stop(); return null; }
        return c - 1;
      });
    }, 1000);
  };

  const stopListening = () => {
    recognitionRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    setListening(false);
    setCountdown(null);
  };

  const handleSubmit = () => { if (text.trim().length >= 10) onSubmit(text.trim()); };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  return (
    <div className="rounded-2xl overflow-hidden shadow-sm" style={{ background: 'white', border: '1px solid #D0D8DE' }}>
      {/* Header strip */}
      <div className="px-5 py-3 flex items-center gap-2"
        style={{ background: 'linear-gradient(90deg, #D5EFF5, #EFF9FB)', borderBottom: '1px solid #AADEED' }}>
        <svg className="w-4 h-4" style={{ color: '#1A7A9A' }} fill="currentColor" viewBox="0 0 20 20">
          <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/>
          <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd"/>
        </svg>
        <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: '#155F79' }}>
          Client Notes
        </span>
      </div>

      <div className="p-5">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={5}
          className="w-full rounded-xl px-4 py-3 text-sm resize-none transition-all"
          style={{
            background: '#F5F7F8',
            border: `2px solid ${text ? '#1A7A9A' : '#D0D8DE'}`,
            color: '#1A2330',
            outline: 'none',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = '#1A7A9A'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(26,122,154,0.12)'; }}
          onBlur={e  => { e.currentTarget.style.borderColor = text ? '#1A7A9A' : '#D0D8DE'; e.currentTarget.style.boxShadow = 'none'; }}
        />

        <div className="flex items-center gap-3 mt-3">
          {SpeechRecognitionAPI && (
            <button
              onMouseDown={startListening}
              onMouseUp={stopListening}
              onTouchStart={startListening}
              onTouchEnd={stopListening}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all flex-shrink-0"
              style={listening
                ? { background: '#1A7A9A', color: 'white', boxShadow: '0 0 0 3px rgba(26,122,154,0.2)' }
                : { background: '#D5EFF5', color: '#155F79', border: '1px solid #AADEED' }
              }
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.42 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>
              </svg>
              {listening ? `Listening… ${countdown}s` : 'Hold to speak'}
            </button>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading || text.trim().length < 10}
            className="flex-1 flex items-center justify-center gap-2 font-semibold py-2.5 rounded-xl text-sm transition-all"
            style={loading || text.trim().length < 10
              ? { background: '#E9EDF0', color: '#8A9BAA', cursor: 'not-allowed' }
              : { background: 'linear-gradient(135deg, #0F4259, #1A7A9A)', color: 'white', boxShadow: '0 4px 12px rgba(15,66,89,0.3)' }
            }
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
                Routing…
              </>
            ) : 'Route Client →'}
          </button>
        </div>

        {text.trim().length > 0 && text.trim().length < 10 && (
          <p className="text-xs mt-2 font-medium" style={{ color: '#B45309' }}>
            Please add more detail (min 10 characters).
          </p>
        )}
      </div>
    </div>
  );
}
