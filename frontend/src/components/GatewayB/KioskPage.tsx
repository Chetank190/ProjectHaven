import { useState, useEffect, useRef } from 'react';
import api from '../../api/client';
import { KIOSK_HUBS, KIOSK_DEFAULT_HUB, VOICE_SESSION_IDLE_MS } from '../../config';
import type { KioskSessionResponse, KioskRouteResponse } from '../../types/api';
import { useSpeech }       from '../shared/useSpeech';
import { VoiceOrb }        from './VoiceOrb';
import { EligibilityFlow } from './EligibilityFlow';
import { KioskItinerary }  from './KioskItinerary';

type KioskState =
  | 'idle' | 'hub_select' | 'recording'
  | 'processing' | 'eligibility' | 'routing'
  | 'speaking' | 'done';

const HUB_NAMES = Object.keys(KIOSK_HUBS);

export function KioskPage() {
  const { speak, startListening, stopListening, transcript, clearTranscript } = useSpeech();
  const [kioskState,  setKioskState]  = useState<KioskState>('idle');
  const [hubName,     setHubName]     = useState<string>(KIOSK_DEFAULT_HUB);
  const [sessionId,   setSessionId]   = useState<string | null>(null);
  const [questions,   setQuestions]   = useState<string[]>([]);
  const [routeResult, setRouteResult] = useState<KioskRouteResponse | null>(null);
  const [error,       setError]       = useState<string | null>(null);

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hubCoords    = KIOSK_HUBS[hubName] ?? KIOSK_HUBS[KIOSK_DEFAULT_HUB];

  const resetIdle = () => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
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
        speak('Haven Matrix. Hold the orb and tell me what you need.');
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [kioskState]);

  const handleOrbDown = () => {
    if (kioskState !== 'idle' && kioskState !== 'done') return;
    setError(null);
    clearTranscript();
    startListening(false);
    setKioskState('recording');
    resetIdle();
  };

  const handleOrbUp = async () => {
    if (kioskState !== 'recording') return;
    stopListening();
    setKioskState('processing');

    const captured = transcript;
    if (!captured || captured.trim().length < 5) {
      speak("I didn't hear anything. Hold the orb and try again.", () => setKioskState('idle'));
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
      speak("Something went wrong. Please try again.", () => setKioskState('idle'));
    }
  };

  const submitRoute = async (sid: string, answers: Record<string, boolean | string | null>) => {
    setKioskState('routing');
    try {
      const r = await api.post<KioskRouteResponse>('/kiosk/route', {
        session_id:          sid,
        eligibility_answers: answers,
      });
      setRouteResult(r.data);
      setKioskState('speaking');
    } catch {
      speak("I couldn't find your route. Please call 211 for help.", () => setKioskState('idle'));
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
    <div className="min-h-screen flex flex-col"
      style={{ background: 'linear-gradient(160deg, #0A1E2E 0%, #0D2436 50%, #061825 100%)' }}>

      {/* Subtle hub label */}
      <div className="absolute top-4 left-4 text-xs font-medium tracking-widest uppercase"
        style={{ color: 'rgba(26,147,187,0.35)' }}>
        {hubName}
      </div>

      {/* Haven Matrix wordmark */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2">
        <svg className="w-5 h-5" style={{ color: 'rgba(56,174,210,0.5)' }} fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944z" clipRule="evenodd"/>
        </svg>
        <span className="text-xs font-medium tracking-widest uppercase"
          style={{ color: 'rgba(114,200,226,0.45)' }}>
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

      <div className="flex-1">
        <VoiceOrb
          state={orbState}
          onPointerDown={handleOrbDown}
          onPointerUp={handleOrbUp}
        />
      </div>
    </div>
  );
}
