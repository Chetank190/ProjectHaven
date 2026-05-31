import { useRef, useState, useCallback, useEffect } from 'react';
import { VOICE_HOLD_MAX_MS, VOICE_SILENCE_KILL_MS } from '../../config';
import { cLog, cWarn, cErr } from '../../lib/clientLog';

export interface SpeechState {
  isListening:     boolean;
  isRecording:     boolean;
  isSpeaking:      boolean;
  transcript:      string;   // live: interim + final (for display)
  transcriptFinal: string;   // confirmed-final only (for logic — use this in eligibility)
}

export interface SpeechControls {
  startListening:   (continuous?: boolean) => void;
  stopListening:    () => void;
  startRecording:   () => Promise<void>;
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
  const [isListening,     setListening]     = useState(false);
  const [isRecording,     setRecording]     = useState(false);
  const [isSpeaking,      setSpeaking]      = useState(false);
  const [transcript,      setTranscript]    = useState('');
  const [transcriptFinal, setTranscriptFinal] = useState('');

  const recognitionRef       = useRef<SpeechRecognition | null>(null);
  const mediaRecRef          = useRef<MediaRecorder | null>(null);
  const audioChunks          = useRef<Blob[]>([]);
  const hardCapRef           = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceRef           = useRef<ReturnType<typeof setTimeout> | null>(null);

  const wantListeningRef     = useRef(false);
  const continuousModeRef    = useRef(false);
  // finalTextRef accumulates confirmed-final text across SR restarts (for `transcript`)
  const finalTextRef         = useRef('');
  // transcriptFinalRef mirrors the same data but drives `transcriptFinal` state separately
  const transcriptFinalRef   = useRef('');

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  useEffect(() => {
    if (!SR) cWarn('sr.unavailable', { hint: 'Chrome required for Web Speech API' });
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
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          const word = e.results[i][0].transcript;
          finalTextRef.current       += word + ' ';
          transcriptFinalRef.current += word + ' ';
          // Update transcriptFinal state immediately on each final result
          setTranscriptFinal(transcriptFinalRef.current.trim());
        }
      }
      // Live display: final + current interim
      const lastResult = e.results[e.results.length - 1];
      const interim = !lastResult.isFinal ? lastResult[0].transcript : '';
      setTranscript((finalTextRef.current + interim).trimEnd());

      // Silence detection: reset timer on every speech event
      if (silenceRef.current) clearTimeout(silenceRef.current);
      silenceRef.current = setTimeout(() => sr.stop(), VOICE_SILENCE_KILL_MS);
    };

    sr.onend = () => {
      clearTimers();
      if (wantListeningRef.current && continuousModeRef.current) {
        setTimeout(() => {
          if (!wantListeningRef.current) return;
          const newSr = _buildRecognizer();
          if (!newSr) return;
          try {
            newSr.start();
            recognitionRef.current = newSr;
          } catch { wantListeningRef.current = false; setListening(false); }
        }, 150);
      } else {
        wantListeningRef.current = false;
        setListening(false);
      }
    };

    sr.onerror = (e: SpeechRecognitionErrorEvent) => {
      clearTimers();
      const benign = e.error === 'no-speech' || e.error === 'aborted';
      if (benign) cLog('sr.error.benign', { error: e.error });
      else        cWarn('sr.error', { error: e.error, message: e.message });
      if (e.error === 'not-allowed') {
        wantListeningRef.current = false;
        setListening(false);
      }
    };

    return sr;
  }, [SR]);

  const startListening = useCallback((continuous = false) => {
    if (!SR || wantListeningRef.current) return;

    finalTextRef.current       = '';
    transcriptFinalRef.current = '';
    continuousModeRef.current  = continuous;
    wantListeningRef.current   = true;
    setTranscript('');
    setTranscriptFinal('');

    const sr = _buildRecognizer();
    if (!sr) return;

    try {
      sr.start();
      cLog('sr.start', { continuous });
    } catch (err) {
      cWarn('sr.start.failed', { error: String(err) });
      wantListeningRef.current = false;
      return;
    }
    recognitionRef.current = sr;

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
    if (mediaRecRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (mediaRecRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      const mr = new MediaRecorder(stream);
      audioChunks.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunks.current.push(e.data); };
      mr.start(250);
      mediaRecRef.current = mr;
      setRecording(true);
    } catch (e) {
      cErr('recorder.start.failed', { error: String(e) });
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
      cLog('asr.request', { size_bytes: blob.size });
      const resp = await fetch('/api/v1/transcribe', { method: 'POST', body: form });
      if (!resp.ok) {
        cWarn('asr.failed', { status: resp.status, fallback: 'webSpeech' });
        return null;
      }
      const data = await resp.json();
      const text = (data.transcript as string) || null;
      cLog('asr.result', { chars: text?.length ?? 0, source: 'nim' });
      return text;
    } catch (e) {
      cWarn('asr.error', { error: String(e), fallback: 'webSpeech' });
      return null;
    }
  }, []);

  const speak = useCallback((text: string, onEnd?: () => void) => {
    wantListeningRef.current = false;
    clearTimers();
    recognitionRef.current?.stop();
    setListening(false);

    window.speechSynthesis.cancel();

    const utt   = new SpeechSynthesisUtterance(text);
    utt.lang    = 'en-US';
    utt.rate    = 0.9;
    utt.pitch   = 0.85;
    const preferred = ['Google UK English Female', 'Samantha', 'Karen', 'Moira', 'Google US English'];
    const voices    = cachedVoices.length ? cachedVoices : window.speechSynthesis.getVoices();
    const voice     = preferred.map(n => voices.find(v => v.name === n)).find(Boolean);
    if (voice) utt.voice = voice;

    // Chrome TTS keepalive — prevents engine from hanging on long utterances
    let keepAlive: ReturnType<typeof setInterval> | null = null;
    const cleanup = () => { if (keepAlive) { clearInterval(keepAlive); keepAlive = null; } };

    utt.onstart = () => {
      setSpeaking(true);
      keepAlive = setInterval(() => {
        if (!window.speechSynthesis.speaking) { cleanup(); return; }
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }, 10_000);
    };
    utt.onend   = () => { cleanup(); setSpeaking(false); onEnd?.(); };
    utt.onerror = () => { cleanup(); setSpeaking(false); onEnd?.(); };

    // setTimeout(0) avoids Chrome cancel()+speak() same-tick race
    setTimeout(() => window.speechSynthesis.speak(utt), 0);
  }, []);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const clearTranscript = useCallback(() => {
    finalTextRef.current       = '';
    transcriptFinalRef.current = '';
    setTranscript('');
    setTranscriptFinal('');
  }, []);

  return {
    isListening, isRecording, isSpeaking,
    transcript, transcriptFinal,
    startListening, stopListening, startRecording, stopRecording, transcribeAudio,
    speak, stopSpeaking, clearTranscript,
  };
}
