import { useState, useEffect, useRef } from 'react';
import api from '../../api/client';
import {
  KIOSK_HUBS, KIOSK_DEFAULT_HUB,
  VOICE_SESSION_IDLE_MS,
} from '../../config';
import type {
  KioskSessionResponse,
  KioskRouteResponse,
  NeedsPayload,
} from '../../types/api';
import { useSpeech }       from '../shared/useSpeech';
import { VoiceOrb }        from './VoiceOrb';
import { EligibilityFlow } from './EligibilityFlow';
import { KioskItinerary }  from './KioskItinerary';

type KioskState =
  | 'idle'
  | 'hub_select'
  | 'recording'
  | 'processing'
  | 'eligibility'
  | 'routing'
  | 'speaking'
  | 'done';

const HUB_NAMES = Object.keys(KIOSK_HUBS);

export function KioskPage() {
  const { speak, startListening, stopListening, transcript, clearTranscript, isSpeaking } = useSpeech();
  const [kioskState,  setKioskState]  = useState<KioskState>('idle');
  const [hubName,     setHubName]     = useState<string>(KIOSK_DEFAULT_HUB);
  const [sessionId,   setSessionId]   = useState<string | null>(null);
  const [questions,   setQuestions]   = useState<string[]>([]);
  const [routeResult, setRouteResult] = useState<KioskRouteResponse | null>(null);
  const [error,       setError]       = useState<string | null>(null);

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hubCoords = KIOSK_HUBS[hubName] ?? KIOSK_HUBS[KIOSK_DEFAULT_HUB];

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

  // Greet on idle
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

  // Hub selection screen (shown if no hub is pre-configured)
  if (!KIOSK_DEFAULT_HUB && kioskState === 'idle' && !hubName) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-6 p-8">
        <h1 className="text-4xl font-light text-white">Select your location</h1>
        {HUB_NAMES.map(name => (
          <button
            key={name}
            onClick={() => setHubName(name)}
            className="text-3xl font-light bg-gray-800 hover:bg-gray-700 text-white rounded-2xl px-10 py-5 transition w-full max-w-sm"
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
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <EligibilityFlow
          questions={questions}
          onComplete={onEligibilityComplete}
          onSkip={() => sessionId && submitRoute(sessionId, {})}
        />
      </div>
    );
  }

  const orbState = (
    kioskState === 'recording'   ? 'listening'  :
    kioskState === 'processing'  ? 'processing' :
    kioskState === 'routing'     ? 'processing' :
    'idle'
  );

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Hub label */}
      <div className="absolute top-4 left-4 text-gray-600 text-sm">{hubName}</div>

      {error && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-900 text-red-200 px-4 py-2 rounded-xl text-sm">
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
