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
  | 'speaking' | 'crisis' | 'done';

const HUB_NAMES = Object.keys(KIOSK_HUBS);

export function KioskPage() {
  const {
    speak, startListening, stopListening, transcript, clearTranscript,
    startRecording, stopRecording, transcribeAudio,
  } = useSpeech();
  const [kioskState,      setKioskState]      = useState<KioskState>('idle');
  const [hubName,         setHubName]         = useState<string>(KIOSK_DEFAULT_HUB);
  const [sessionId,       setSessionId]       = useState<string | null>(null);
  const [questions,       setQuestions]       = useState<string[]>([]);
  const [routeResult,     setRouteResult]     = useState<KioskRouteResponse | null>(null);
  const [crisisHotline,   setCrisisHotline]   = useState<string | null>(null);
  const [crisisText,      setCrisisText]      = useState<string | null>(null);
  const [error,           setError]           = useState<string | null>(null);

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
      startListening(true);    // Web Speech API — continuous mode so pauses don't cut transcript
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
      if (r.data.next_step === 'crisis') {
        setCrisisHotline(r.data.crisis_hotline ?? '988');
        setCrisisText(r.data.escalation_text ?? '');
        setKioskState('crisis');
        speak(r.data.escalation_text ?? 'Please call 9-8-8 for crisis support.');
        return;
      }
      setSessionId(r.data.session_id);
      if (r.data.next_step === 'collect_eligibility' && r.data.eligibility_questions.length > 0) {
        setQuestions(r.data.eligibility_questions);
        setKioskState('eligibility');
      } else {
        await submitRoute(r.data.session_id!, {});
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

  // Hub selection — show when no hub chosen yet, or when user taps Change
  if (kioskState === 'hub_select' || (kioskState === 'idle' && !hubName)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-start px-6 py-10"
        style={{ background: 'linear-gradient(160deg, #0A1E2E 0%, #0D2436 60%, #061825 100%)' }}>

        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <HavenMatrixLogo size={22} />
          <span className="text-xs font-medium tracking-widest uppercase"
            style={{ color: 'rgba(114,200,226,0.55)' }}>Haven Matrix</span>
        </div>
        <h1 className="text-3xl font-light mb-1 mt-4 text-center"
          style={{ color: 'rgba(114,200,226,0.9)' }}>
          Where are you right now?
        </h1>
        <p className="text-sm mb-8 text-center"
          style={{ color: 'rgba(255,255,255,0.3)' }}>
          Choose your nearest location for accurate directions
        </p>

        {/* 2-column grid */}
        <div className="w-full max-w-lg grid grid-cols-2 gap-3">
          {HUB_NAMES.map(name => {
            const isSelected = name === hubName;
            return (
              <button
                key={name}
                onClick={() => { setHubName(name); setKioskState('idle'); }}
                className="text-left rounded-2xl px-4 py-4 transition-all"
                style={{
                  background: isSelected ? 'rgba(26,147,187,0.20)' : 'rgba(255,255,255,0.04)',
                  border: isSelected
                    ? '1px solid rgba(56,174,210,0.6)'
                    : '1px solid rgba(255,255,255,0.08)',
                  color: isSelected ? '#72C8E2' : 'rgba(255,255,255,0.75)',
                  boxShadow: isSelected ? '0 0 12px rgba(26,147,187,0.25)' : 'none',
                }}>
                <div className="text-sm font-medium leading-snug">{name}</div>
                {isSelected && (
                  <div className="text-xs mt-1" style={{ color: 'rgba(114,200,226,0.6)' }}>
                    ✓ Selected
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Only show Cancel if user came from idle (hub was already set) */}
        {hubName && kioskState === 'hub_select' && (
          <button
            onClick={() => setKioskState('idle')}
            className="mt-8 text-sm font-light px-6 py-3 rounded-xl"
            style={{ color: 'rgba(114,200,226,0.4)', border: '1px solid rgba(26,147,187,0.15)' }}>
            Cancel
          </button>
        )}
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

  if (kioskState === 'crisis') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8 py-12 text-center"
        style={{ background: 'linear-gradient(160deg, #0A1E2E 0%, #1A0A0A 100%)' }}>
        <div className="text-6xl mb-6">🆘</div>
        <h2 className="text-4xl font-light mb-4" style={{ color: 'rgba(255,200,100,0.9)' }}>
          Help is available
        </h2>
        <p className="text-2xl font-light leading-relaxed max-w-lg mb-8"
          style={{ color: 'rgba(255,255,255,0.8)' }}>
          {crisisText}
        </p>
        <div className="text-5xl font-bold mb-8" style={{ color: '#FBBF24' }}>
          {crisisHotline}
        </div>
        <button
          onClick={() => { setKioskState('idle'); setCrisisHotline(null); setCrisisText(null); }}
          className="mt-4 text-lg font-light px-8 py-4 rounded-2xl transition-all"
          style={{
            color: 'rgba(114,200,226,0.5)',
            border: '1px solid rgba(26,147,187,0.2)',
            background: 'rgba(26,147,187,0.04)',
          }}>
          Tap to return to main screen
        </button>
      </div>
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

      {/* Location chip — tap to change */}
      <button
        onClick={() => setKioskState('hub_select')}
        className="absolute top-4 left-4 flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all"
        style={{
          background: 'rgba(26,147,187,0.10)',
          border: '1px solid rgba(56,174,210,0.20)',
        }}>
        <span className="text-xs" style={{ color: 'rgba(114,200,226,0.55)' }}>📍</span>
        <span className="text-xs font-medium tracking-wide"
          style={{ color: 'rgba(114,200,226,0.55)' }}>
          {hubName}
        </span>
        <span className="text-xs" style={{ color: 'rgba(114,200,226,0.30)' }}>›</span>
      </button>

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
