import { useState, useEffect, useRef } from 'react';
import api from '../../api/client';
import {
  KIOSK_HUBS, KIOSK_DEFAULT_HUB,
  VOICE_SESSION_IDLE_MS,
} from '../../config';
import type {
  KioskSessionResponse,
  KioskRouteResponse,
} from '../../types/api';
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

  // Hub selection
  if (!KIOSK_DEFAULT_HUB && kioskState === 'idle' && !hubName) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-8"
        style={{ background: 'linear-gradient(160deg, #160B0F, #231316)' }}>
        <h1 className="text-4xl font-light mb-4" style={{ color: 'rgba(212,165,58,0.8)' }}>
          Select your location
        </h1>
        {HUB_NAMES.map(name => (
          <button
            key={name}
            onClick={() => setHubName(name)}
            className="text-2xl font-light rounded-2xl px-10 py-5 transition-all w-full max-w-sm"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(184,115,51,0.3)',
              color: 'white',
            }}
          >
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
        style={{ background: 'linear-gradient(160deg, #160B0F, #231316)' }}>
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
      style={{ background: 'linear-gradient(160deg, #160B0F 0%, #1A0E10 50%, #231316 100%)' }}>

      {/* Hub label — subtle top-left */}
      <div className="absolute top-4 left-4 text-xs font-medium tracking-widest uppercase"
        style={{ color: 'rgba(184,115,51,0.4)' }}>
        {hubName}
      </div>

      {/* Haven Matrix wordmark — top center */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2">
        <div className="w-5 h-5 rounded-md flex items-center justify-center"
          style={{ background: 'rgba(184,115,51,0.2)', border: '1px solid rgba(184,115,51,0.4)' }}>
          <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none">
            <path d="M8 2L14 6v4l-6 4L2 10V6z" fill="#B87333" opacity="0.9"/>
          </svg>
        </div>
        <span className="text-xs font-semibold tracking-widest uppercase"
          style={{ color: 'rgba(212,165,58,0.5)' }}>
          Haven Matrix
        </span>
      </div>

      {error && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 rounded-xl px-5 py-2.5 text-sm font-medium"
          style={{ background: 'rgba(194,59,82,0.2)', border: '1px solid rgba(194,59,82,0.4)', color: '#F4B0BB' }}>
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
