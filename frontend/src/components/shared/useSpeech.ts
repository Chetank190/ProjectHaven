import { useRef, useState, useCallback } from 'react';
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
  stopRecording:    () => Blob | null;
  speak:            (text: string, onEnd?: () => void) => void;
  stopSpeaking:     () => void;
  clearTranscript:  () => void;
}

export function useSpeech(): SpeechState & SpeechControls {
  const [isListening,  setListening]  = useState(false);
  const [isRecording,  setRecording]  = useState(false);
  const [isSpeaking,   setSpeaking]   = useState(false);
  const [transcript,   setTranscript] = useState('');

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const mediaRecRef    = useRef<MediaRecorder | null>(null);
  const audioChunks    = useRef<Blob[]>([]);
  const hardCapRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceRef     = useRef<ReturnType<typeof setTimeout> | null>(null);

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SR) {
    console.warn('[useSpeech] webkitSpeechRecognition not available. Chrome required.');
  }

  const clearTimers = () => {
    if (hardCapRef.current) clearTimeout(hardCapRef.current);
    if (silenceRef.current) clearTimeout(silenceRef.current);
  };

  const startListening = useCallback((continuous = false) => {
    if (!SR || isListening) return;
    setTranscript('');

    const sr = new SR();
    sr.continuous     = continuous;
    sr.interimResults = true;
    sr.lang           = 'en-CA';

    sr.onresult = (e: SpeechRecognitionEvent) => {
      const t = Array.from(e.results).map((r: SpeechRecognitionResult) => r[0].transcript).join('');
      setTranscript(t);
      // Reset silence timer on each result
      if (silenceRef.current) clearTimeout(silenceRef.current);
      silenceRef.current = setTimeout(() => {
        sr.stop();
      }, VOICE_SILENCE_KILL_MS);
    };

    sr.onend = () => {
      clearTimers();
      setListening(false);
    };

    sr.onerror = () => {
      clearTimers();
      setListening(false);
    };

    sr.start();
    recognitionRef.current = sr;
    setListening(true);

    // Hard cap
    hardCapRef.current = setTimeout(() => sr.stop(), VOICE_HOLD_MAX_MS);
  }, [SR, isListening]);

  const stopListening = useCallback(() => {
    clearTimers();
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      audioChunks.current = [];
      mr.ondataavailable = e => audioChunks.current.push(e.data);
      mr.start();
      mediaRecRef.current = mr;
      setRecording(true);
    } catch (e) {
      console.error('[useSpeech] MediaRecorder failed:', e);
    }
  }, []);

  const stopRecording = useCallback((): Blob | null => {
    const mr = mediaRecRef.current;
    if (!mr) return null;
    mr.stop();
    mr.stream.getTracks().forEach(t => t.stop());
    mediaRecRef.current = null;
    setRecording(false);
    return new Blob(audioChunks.current, { type: 'audio/webm' });
  }, []);

  const speak = useCallback((text: string, onEnd?: () => void) => {
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang  = 'en-CA';
    utt.rate  = 0.9;
    utt.onstart = () => setSpeaking(true);
    utt.onend   = () => { setSpeaking(false); onEnd?.(); };
    utt.onerror = () => { setSpeaking(false); onEnd?.(); };
    window.speechSynthesis.speak(utt);
  }, []);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const clearTranscript = useCallback(() => setTranscript(''), []);

  return {
    isListening, isRecording, isSpeaking, transcript,
    startListening, stopListening, startRecording, stopRecording,
    speak, stopSpeaking, clearTranscript,
  };
}
