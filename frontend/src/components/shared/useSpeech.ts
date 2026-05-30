import { useRef, useState, useCallback, useEffect } from 'react';
import { VOICE_HOLD_MAX_MS, VOICE_SILENCE_KILL_MS } from '../../config';

export interface SpeechState {
  isListening:  boolean;
  isRecording:  boolean;
  isSpeaking:   boolean;
  transcript:   string;
}

export interface SpeechControls {
  startListening:   (continuous?: boolean) => void;
  stopListening:    () => void;
  startRecording:   () => void;
  stopRecording:    () => Promise<Blob | null>;
  transcribeAudio:  (blob: Blob) => Promise<string | null>;
  speak:            (text: string, onEnd?: () => void) => void;
  stopSpeaking:     () => void;
  clearTranscript:  () => void;
}

// TTS voices load async — cache them once the browser fires voiceschanged
let cachedVoices: SpeechSynthesisVoice[] = [];
if (typeof window !== 'undefined') {
  const load = () => { cachedVoices = window.speechSynthesis.getVoices(); };
  load();
  window.speechSynthesis.addEventListener('voiceschanged', load);
}

export function useSpeech(): SpeechState & SpeechControls {
  const [isListening, setListening] = useState(false);
  const [isRecording, setRecording] = useState(false);
  const [isSpeaking,  setSpeaking]  = useState(false);
  const [transcript,  setTranscript] = useState('');

  const recognitionRef   = useRef<SpeechRecognition | null>(null);
  const mediaRecRef      = useRef<MediaRecorder | null>(null);
  const audioChunks      = useRef<Blob[]>([]);
  const hardCapRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceRef       = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track intent so auto-restart knows when NOT to restart
  const wantListeningRef  = useRef(false);
  const continuousModeRef = useRef(false);
  // Accumulate confirmed-final text across restarts so it isn't lost
  const finalTextRef      = useRef('');

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  useEffect(() => {
    if (!SR) console.warn('[useSpeech] webkitSpeechRecognition unavailable — Chrome required.');
  }, []);

  const clearTimers = () => {
    if (hardCapRef.current) clearTimeout(hardCapRef.current);
    if (silenceRef.current) clearTimeout(silenceRef.current);
  };

  const _buildRecognizer = useCallback(() => {
    if (!SR) return null;
    const sr = new SR();
    sr.continuous     = continuousModeRef.current;
    sr.interimResults = true;
    sr.lang           = 'en-IN';

    sr.onstart = () => setListening(true);

    sr.onresult = (e: SpeechRecognitionEvent) => {
      // Process only newly arrived results from e.resultIndex onward
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          finalTextRef.current += e.results[i][0].transcript + ' ';
        }
      }
      // Current interim segment (last non-final result, if any)
      const lastResult = e.results[e.results.length - 1];
      const interim = !lastResult.isFinal ? lastResult[0].transcript : '';
      setTranscript((finalTextRef.current + interim).trimEnd());

      // Reset silence timer on every speech event
      if (silenceRef.current) clearTimeout(silenceRef.current);
      silenceRef.current = setTimeout(() => sr.stop(), VOICE_SILENCE_KILL_MS);
    };

    sr.onend = () => {
      clearTimers();
      // Auto-restart if the caller still wants continuous listening
      // (Chrome terminates recognition on network blips or ~60s timeout)
      if (wantListeningRef.current && continuousModeRef.current) {
        setTimeout(() => {
          if (!wantListeningRef.current) return;
          const newSr = _buildRecognizer();
          if (!newSr) return;
          try {
            newSr.start();
            recognitionRef.current = newSr;
            // Don't reset finalTextRef — preserve accumulated transcript
          } catch { wantListeningRef.current = false; setListening(false); }
        }, 150);
      } else {
        wantListeningRef.current = false;
        setListening(false);
      }
    };

    sr.onerror = (e: SpeechRecognitionErrorEvent) => {
      clearTimers();
      console.warn('[useSpeech] error:', e.error, e.message);
      // 'no-speech' and 'aborted' are benign — let onend handle restart
      if (e.error === 'not-allowed') {
        wantListeningRef.current = false;
        setListening(false);
      }
    };

    return sr;
  }, [SR]);

  const startListening = useCallback((continuous = false) => {
    if (!SR || wantListeningRef.current) return;

    // Reset state for a fresh session
    finalTextRef.current    = '';
    continuousModeRef.current = continuous;
    wantListeningRef.current  = true;
    setTranscript('');

    const sr = _buildRecognizer();
    if (!sr) return;

    try {
      sr.start();
    } catch (err) {
      console.warn('[useSpeech] sr.start() threw:', err);
      wantListeningRef.current = false;
      return;
    }
    recognitionRef.current = sr;

    // Hard cap only applies to the initial session, not auto-restarts
    if (!continuous) {
      hardCapRef.current = setTimeout(() => sr.stop(), VOICE_HOLD_MAX_MS);
    }
  }, [SR, _buildRecognizer]);

  const stopListening = useCallback(() => {
    wantListeningRef.current = false;
    clearTimers();
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      // Explicit audio constraints improve quality in noisy environments (kiosk)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation:  true,
          noiseSuppression:  true,
          autoGainControl:   true,
        },
      });
      const mr = new MediaRecorder(stream);
      audioChunks.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunks.current.push(e.data); };
      mr.start(250);
      mediaRecRef.current = mr;
      setRecording(true);
    } catch (e) {
      console.error('[useSpeech] MediaRecorder failed:', e);
    }
  }, []);

  const stopRecording = useCallback((): Promise<Blob | null> => {
    const mr = mediaRecRef.current;
    if (!mr) return Promise.resolve(null);
    mediaRecRef.current = null;
    setRecording(false);
    return new Promise(resolve => {
      mr.onstop = () => {
        mr.stream.getTracks().forEach(t => t.stop());
        resolve(new Blob(audioChunks.current, { type: mr.mimeType || 'audio/webm' }));
      };
      mr.stop();
    });
  }, []);

  const transcribeAudio = useCallback(async (blob: Blob): Promise<string | null> => {
    try {
      const form = new FormData();
      form.append('audio', blob, 'recording.webm');
      const resp = await fetch('/api/v1/transcribe', { method: 'POST', body: form });
      if (!resp.ok) return null;
      const data = await resp.json();
      return (data.transcript as string) || null;
    } catch {
      return null;
    }
  }, []);

  const speak = useCallback((text: string, onEnd?: () => void) => {
    window.speechSynthesis.cancel();
    const utt  = new SpeechSynthesisUtterance(text);
    utt.lang   = 'en-US'; // en-IN TTS voices are rarely installed; en-US is always present
    utt.rate   = 0.9;
    utt.pitch  = 0.85;
    const preferred = ['Google UK English Female', 'Samantha', 'Karen', 'Moira', 'Google US English'];
    // Use cached voices (populated by voiceschanged event at module load)
    const voices = cachedVoices.length ? cachedVoices : window.speechSynthesis.getVoices();
    const voice  = preferred.map(n => voices.find(v => v.name === n)).find(Boolean);
    if (voice) utt.voice = voice;
    utt.onstart = () => setSpeaking(true);
    utt.onend   = () => { setSpeaking(false); onEnd?.(); };
    utt.onerror = () => { setSpeaking(false); onEnd?.(); };
    window.speechSynthesis.speak(utt);
  }, []);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const clearTranscript = useCallback(() => {
    finalTextRef.current = '';
    setTranscript('');
  }, []);

  return {
    isListening, isRecording, isSpeaking, transcript,
    startListening, stopListening, startRecording, stopRecording, transcribeAudio,
    speak, stopSpeaking, clearTranscript,
  };
}
