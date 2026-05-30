import { useState, useEffect, useRef } from 'react';
import api from '../../api/client';
import { KIOSK_HUBS, KIOSK_DEFAULT_HUB, VOICE_SESSION_IDLE_MS, VOICE_MIN_CHARS } from '../../config';
import type { KioskSessionResponse, KioskRouteResponse } from '../../types/api';
import { useSpeech }       from '../shared/useSpeech';
import { VoiceOrb }        from './VoiceOrb';
import { EligibilityFlow } from './EligibilityFlow';
import { KioskItinerary }  from './KioskItinerary';
import { HavenMatrixLogo } from '../shared/HavenMatrixLogo';

type KioskState =
  | 'idle' | 'hub_select' | 'recording'
  | 'processing' | 'eligibility' | 'routing'
  | 'speaking' | 'done';

const HUB_NAMES = Object.keys(KIOSK_HUBS);

export function KioskPage() {
  const {
    speak, startListening, stopListening, transcript, clearTranscript,
    startRecording, stopRecording, transcribeAudio,
  } = useSpeech();
  const [kioskState,  setKioskState]  = useState<KioskState>('idle');
  const [hubName,     setHubName]     = useState<string>(KIOSK_DEFAULT_HUB);
  const [sessionId,   setSessionId]   = useState<string | null>(null);
  const [questions,   setQuestions]   = useState<string[]>([]);
  const [routeResult, setRouteResult] = useState<KioskRouteResponse | null>(null);
  const [error,       setError]       = useState<string | null>(null);

  const idleTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kioskStateRef  = useRef<KioskState>('idle');
  const hubCoords      = KIOSK_HUBS[hubName] ?? KIOSK_HUBS[KIOSK_DEFAULT_HUB];

  useEffect(() => { kioskStateRef.current = kioskState; }, [kioskState]);

  const resetIdle = () => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      if (['eligibility', 'routing', 'processing'].includes(kioskStateRef.current)) return;
      window.speechSynthesis.cancel();
      setKioskState('idle');
      setSessionId(null);
      setQuestions([]);
      setRouteResult(null);
    }, VOICE_SESSION_IDLE_MS);
  };

  useEffect(() => {
    if (kioskState === 'idle') {
      const timer = setTimeout(() => {
        speak("Welcome. I'm here to help you find shelter, food, or care. Tap the button and tell me what you need.");
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [kioskState]);

  // Tap-to-toggle: first tap starts recording (ASR NIM) + listening (Web Speech live display)
  // Second tap: stop both, try ASR NIM transcript first, fall back to Web Speech
  const handleOrbTap = async () => {
    if (kioskState === 'idle' || kioskState === 'done') {
      setError(null);
      clearTranscript();
      startListening(false);   // Web Speech API — live transcript display only
      startRecording();        // MediaRecorder — audio blob for ASR NIM
      setKioskState('recording');
      resetIdle();
      return;
    }

    if (kioskState !== 'recording') return;
    stopListening();
    setKioskState('processing');

    // Collect audio blob; fall back to Web Speech transcript if ASR unavailable
    const blob = await stopRecording();
    let captured = '';
    if (blob && blob.size > 0) {
      const asrText = await transcribeAudio(blob);
      if (asrText) captured = asrText;
    }
    if (!captured) captured = transcript;  // Web Speech fallback

    if (!captured || captured.trim().length < VOICE_MIN_CHARS) {
      speak("I'm sorry, I didn't catch that. Please tap the button and try again.", () => setKioskState('idle'));
      return;
    }

    try {
      const r = await api.post<KioskSessionResponse>('/kiosk/session', {
        transcript:  captured,
        origin_lat:  hubCoords[0],
        origin_lon:  hubCoords[1],
      });
      setSessionId(r.data.session_id);
      if (r.data.next_step === 'collect_eligibility' && r.data.eligibility_questions.length > 0) {
        setQuestions(r.data.eligibility_questions);
        setKioskState('eligibility');
      } else {
        await submitRoute(r.data.session_id, {});
      }
    } catch {
      const msg = "I'm sorry, something went wrong. Please tap to try again.";
      setError(msg);
      speak(msg, () => { setError(null); setKioskState('idle'); });
    }
  };

  const submitRoute = async (sid: string, answers: Record<string, boolean | string | null>) => {
    setKioskState('routing');
    try {
      const r = await api.post<KioskRouteResponse>('/kiosk/route', {
        session_id:          sid,
        eligibility_answers: answers,
      });
      setError(null);
      setRouteResult(r.data);
      setKioskState('speaking');
    } catch {
      const msg = "I'm sorry, I wasn't able to find anything right now. You can also call 2-1-1 for help.";
      setError(msg);
      speak(msg, () => { setError(null); setKioskState('idle'); });
    }
  };

  const onEligibilityComplete = (answers: Record<string, boolean | string | null>) => {
    if (sessionId) submitRoute(sessionId, answers);
  };

  // Hub selection (if no hub pre-configured)
  if (!KIOSK_DEFAULT_HUB && kioskState === 'idle' && !hubName) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-5 p-8"
        style={{ background: 'linear-gradient(160deg, #0A1E2E, #0D2436)' }}>
        <h1 className="text-4xl font-light mb-4" style={{ color: 'rgba(114,200,226,0.8)' }}>
          Select your location
        </h1>
        {HUB_NAMES.map(name => (
          <button key={name} onClick={() => setHubName(name)}
            className="text-2xl font-light rounded-2xl px-10 py-5 w-full max-w-sm transition-all"
            style={{ background: 'rgba(26,147,187,0.08)', border: '1px solid rgba(56,174,210,0.25)', color: 'white' }}>
            {name}
          </button>
        ))}
      </div>
    );
  }

  if (kioskState === 'speaking' && routeResult) {
    return (
      <KioskItinerary
        itinerary={routeResult.itinerary}
        ttsScript={routeResult.tts_script}
        onReset={() => { setKioskState('idle'); setRouteResult(null); setSessionId(null); }}
      />
    );
  }

  if (kioskState === 'eligibility') {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: 'linear-gradient(160deg, #0A1E2E, #0D2436)' }}>
        <EligibilityFlow
          questions={questions}
          onComplete={onEligibilityComplete}
          onSkip={() => sessionId && submitRoute(sessionId, {})}
        />
      </div>
    );
  }

  const orbState = (
    kioskState === 'recording'  ? 'listening'  :
    kioskState === 'processing' ? 'processing' :
    kioskState === 'routing'    ? 'processing' :
    'idle'
  );

  return (
    <div className="min-h-screen flex flex-col relative"
      style={{ background: 'linear-gradient(160deg, #0A1E2E 0%, #0D2436 50%, #061825 100%)' }}>

      {/* Subtle hub label */}
      <div className="absolute top-4 left-4 text-xs font-medium tracking-widest uppercase"
        style={{ color: 'rgba(26,147,187,0.35)' }}>
        {hubName}
      </div>

      {/* Haven Matrix wordmark */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2">
        <HavenMatrixLogo size={22} />
        <span className="text-xs font-medium tracking-widest uppercase"
          style={{ color: 'rgba(114,200,226,0.55)' }}>
          Haven Matrix
        </span>
      </div>

      {/* Non-alarming error message */}
      {error && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 rounded-xl px-5 py-2.5 text-sm font-medium"
          style={{ background: 'rgba(26,147,187,0.15)', border: '1px solid rgba(56,174,210,0.3)', color: '#AADEED' }}>
          {error}
        </div>
      )}

      <div className="flex-1 relative">
        <VoiceOrb
          state={orbState}
          onClick={handleOrbTap}
        />

        {/* Live transcript — shown while recording and briefly during processing */}
        {(kioskState === 'recording' || kioskState === 'processing') && transcript && (
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 w-full max-w-sm px-6 text-center pointer-events-none">
            <p className="text-xl font-light leading-relaxed"
               style={{ color: 'rgba(114,200,226,0.85)' }}>
              {transcript}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
