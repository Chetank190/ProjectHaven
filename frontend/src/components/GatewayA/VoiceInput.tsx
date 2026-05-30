// Phase 4: text input placeholder. Voice integration added in Phase 5.
import { useState, useRef, useEffect } from 'react';

interface Props {
  onSubmit:    (text: string) => void;
  loading:     boolean;
  placeholder?: string;
}

export function VoiceInput({ onSubmit, loading, placeholder = 'Type or speak client notes here…' }: Props) {
  const [text,       setText]       = useState('');
  const [listening,  setListening]  = useState(false);
  const [countdown,  setCountdown]  = useState<number | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const timerRef       = useRef<ReturnType<typeof setInterval> | null>(null);

  const SpeechRecognitionAPI =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  const startListening = () => {
    if (!SpeechRecognitionAPI) return;
    const sr = new SpeechRecognitionAPI();
    sr.continuous       = false;
    sr.interimResults   = true;
    sr.lang             = 'en-CA';
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

  const handleSubmit = () => {
    if (text.trim().length >= 10) onSubmit(text.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 max-w-2xl w-full">
      <h2 className="text-lg font-semibold text-gray-800 mb-3">Client Notes</h2>

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={5}
        className="w-full border border-gray-300 rounded-xl px-4 py-3 text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
      />

      <div className="flex items-center gap-3 mt-3">
        {SpeechRecognitionAPI && (
          <button
            onMouseDown={startListening}
            onMouseUp={stopListening}
            onTouchStart={startListening}
            onTouchEnd={stopListening}
            className={`px-4 py-2 rounded-xl font-medium transition ${
              listening
                ? 'bg-red-500 text-white animate-pulse'
                : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
            }`}
          >
            {listening ? `🎤 Listening… ${countdown}s` : '🎤 Hold to speak'}
          </button>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading || text.trim().length < 10}
          className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2 rounded-xl transition"
        >
          {loading ? 'Routing…' : 'Route Client →'}
        </button>
      </div>

      {text.trim().length > 0 && text.trim().length < 10 && (
        <p className="text-xs text-amber-600 mt-2">Please add more detail (min 10 characters).</p>
      )}
    </div>
  );
}
