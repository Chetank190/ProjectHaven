import { useRef, useState, useCallback, useEffect } from 'react';
import {
  VOICE_HOLD_MAX_MS, VOICE_ENDPOINT_SILENCE_MS,
  VOICE_RECOGNITION_LANG, VOICE_TTS_LANG,
} from '../../config';
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
  // TTS deferral timer + Chrome keepalive interval. Tracked in refs so a new
  // speak() (or stopSpeaking) can cancel a still-pending one — otherwise two
  // rapid speak() calls each queue an utterance and the message plays twice.
  const speakTimerRef        = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepAliveRef         = useRef<ReturnType<typeof setInterval> | null>(null);

  const wantListeningRef     = useRef(false);
  const continuousModeRef    = useRef(false);
  // True once the Web Speech API reports the user has actually started talking.
  // The end-of-speech timer is only armed after this flips true, so silence
  // BEFORE the user speaks can never cut them off.
  const speechDetectedRef    = useRef(false);
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

  const _clearKeepAlive = () => {
    if (keepAliveRef.current) { clearInterval(keepAliveRef.current); keepAliveRef.current = null; }
  };

  const _buildRecognizer = useCallback(() => {
    if (!SR) return null;
    const sr = new SR();
    sr.continuous     = continuousModeRef.current;
    sr.interimResults = true;
    sr.lang           = VOICE_RECOGNITION_LANG;

    sr.onstart = () => setListening(true);

    // Speech lifecycle: arm the end-of-speech timer only after the user has
    // actually begun speaking, and key it off onspeechend (the API's own
    // "stopped talking" signal) rather than gaps between interim results.
    sr.onspeechstart = () => {
      speechDetectedRef.current = true;
      if (silenceRef.current) { clearTimeout(silenceRef.current); silenceRef.current = null; }
    };
    sr.onspeechend = () => {
      if (silenceRef.current) clearTimeout(silenceRef.current);
      silenceRef.current = setTimeout(() => sr.stop(), VOICE_ENDPOINT_SILENCE_MS);
    };

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

      // Keep the end-of-speech timer fresh while words keep arriving, but only
      // once real speech has been detected — a long thinking pause before the
      // first word must not stop capture.
      if (speechDetectedRef.current) {
        if (silenceRef.current) clearTimeout(silenceRef.current);
        silenceRef.current = setTimeout(() => sr.stop(), VOICE_ENDPOINT_SILENCE_MS);
      }
    };

    sr.onend = () => {
      clearTimers();
      if (wantListeningRef.current && continuousModeRef.current) {
        // Short gap before relaunching — Chrome throws InvalidStateError if start()
        // is called too soon after a recognizer ends. ~100ms is the safe minimum.
        setTimeout(() => {
          if (!wantListeningRef.current || !continuousModeRef.current) return;
          const newSr = _buildRecognizer();
          if (!newSr) return;
          try {
            newSr.start();
            recognitionRef.current = newSr;
          } catch { wantListeningRef.current = false; setListening(false); }
        }, 100);
      } else {
        wantListeningRef.current = false;
        setListening(false);
      }
    };

    sr.onerror = (e: SpeechRecognitionErrorEvent) => {
      clearTimers();
      // no-speech/no-match/aborted are normal in continuous use — the onend
      // restart loop recovers. Only a denied mic permission is fatal.
      const benign = e.error === 'no-speech' || e.error === 'no-match' || e.error === 'aborted';
      if (benign) cLog('sr.error.benign', { error: e.error });
      else        cWarn('sr.error', { error: e.error, message: e.message });
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wantListeningRef.current  = false;
        continuousModeRef.current = false;   // don't try to restart a denied mic
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
    speechDetectedRef.current  = false;
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
    // Hard-stop recognition before TTS so the mic can't pick up our own voice and
    // so an in-flight onend can't relaunch a recognizer mid-utterance.
    wantListeningRef.current  = false;
    continuousModeRef.current = false;
    clearTimers();
    recognitionRef.current?.abort();   // abort (not stop) — no trailing final result to re-arm timers
    setListening(false);

    // Cancel any previous utterance AND any speak() still queued for the next
    // tick. Without clearing the pending timer, a second speak() called in the
    // same tick (e.g. React StrictMode's double-invoked effects, or back-to-back
    // state transitions) queues a second utterance and the message is spoken twice.
    if (speakTimerRef.current) { clearTimeout(speakTimerRef.current); speakTimerRef.current = null; }
    _clearKeepAlive();
    window.speechSynthesis.cancel();

    const utt   = new SpeechSynthesisUtterance(text);
    utt.lang    = VOICE_TTS_LANG;
    utt.rate    = 0.9;
    utt.pitch   = 0.85;
    const preferred = ['Google UK English Female', 'Samantha', 'Karen', 'Moira', 'Google US English'];
    const voices    = cachedVoices.length ? cachedVoices : window.speechSynthesis.getVoices();
    const voice     = preferred.map(n => voices.find(v => v.name === n)).find(Boolean);
    if (voice) utt.voice = voice;

    utt.onstart = () => {
      setSpeaking(true);
      // Chrome TTS keepalive — prevents engine from hanging on long utterances.
      keepAliveRef.current = setInterval(() => {
        if (!window.speechSynthesis.speaking) { _clearKeepAlive(); return; }
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }, 10_000);
    };
    utt.onend   = () => { _clearKeepAlive(); setSpeaking(false); onEnd?.(); };
    utt.onerror = () => { _clearKeepAlive(); setSpeaking(false); onEnd?.(); };

    // setTimeout(0) avoids Chrome cancel()+speak() same-tick race.
    speakTimerRef.current = setTimeout(() => {
      speakTimerRef.current = null;
      window.speechSynthesis.speak(utt);
    }, 0);
  }, []);

  const stopSpeaking = useCallback(() => {
    if (speakTimerRef.current) { clearTimeout(speakTimerRef.current); speakTimerRef.current = null; }
    _clearKeepAlive();
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
