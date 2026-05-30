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
  | 'speaking' | 'crisis' | 'typing' | 'done';

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
  const [typedText,       setTypedText]       = useState('');
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
      // Voice failed silently (noisy environment) — offer text fallback instead of an error
      setTypedText('');
      setKioskState('typing');
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

  const submitText = async (text: string) => {
    if (text.trim().length < VOICE_MIN_CHARS) return;
    setError(null);
    setKioskState('processing');
    try {
      const r = await api.post<KioskSessionResponse>('/kiosk/session', {
        transcript: text.trim(),
        origin_lat: hubCoords[0],
        origin_lon: hubCoords[1],
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
      setKioskState('typing');  // stay on typing screen so they can retry
    }
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

  if (kioskState === 'typing') {
    const ready = typedText.trim().length >= VOICE_MIN_CHARS;
    return (
      <div className="min-h-screen flex flex-col"
        style={{ background: 'linear-gradient(160deg, #0A1E2E 0%, #0D2436 60%, #061825 100%)' }}>

        {/* Top bar */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <button
            tabIndex={0}
            onClick={() => { setTypedText(''); setKioskState('idle'); }}
            className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-full transition-all"
            style={{
              color: 'rgba(114,200,226,0.65)',
              background: 'rgba(26,147,187,0.08)',
              border: '1px solid rgba(56,174,210,0.18)',
            }}>
            🎤 Switch to voice
          </button>
          <span className="text-xs" style={{ color: 'rgba(114,200,226,0.30)' }}>
            📍 {hubName}
          </span>
        </div>

        {/* Prompt */}
        <div className="px-6 pt-4 pb-6">
          <h2 className="text-3xl font-light mb-2" style={{ color: 'rgba(255,255,255,0.90)' }}>
            Tell us what you need
          </h2>
          <p className="text-base" style={{ color: 'rgba(255,255,255,0.35)' }}>
            Describe your situation — shelter, food, support, or anything else
          </p>
        </div>

        {/* Large textarea */}
        <div className="flex-1 px-6">
          <textarea
            value={typedText}
            onChange={e => setTypedText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && ready) { e.preventDefault(); submitText(typedText); } }}
            placeholder="e.g. I need a shelter for tonight. I don't have ID. I've been drinking."
            rows={7}
            autoFocus
            className="w-full rounded-2xl p-5 resize-none outline-none leading-relaxed"
            style={{
              fontSize: '1.2rem',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(56,174,210,0.25)',
              color: 'rgba(255,255,255,0.90)',
              caretColor: '#38AED2',
            }}
          />
          <p className="text-xs mt-2 text-right" style={{ color: 'rgba(255,255,255,0.20)' }}>
            {typedText.trim().length} chars — {VOICE_MIN_CHARS} min
          </p>
        </div>

        {/* Submit */}
        <div className="px-6 pb-10 pt-4">
          <button
            onClick={() => submitText(typedText)}
            disabled={!ready}
            className="w-full py-5 rounded-2xl text-xl font-medium transition-all"
            style={{
              background: ready ? 'linear-gradient(135deg, #1A7A9A, #38AED2)' : 'rgba(255,255,255,0.05)',
              color: ready ? 'white' : 'rgba(255,255,255,0.20)',
              border: ready ? 'none' : '1px solid rgba(255,255,255,0.08)',
              cursor: ready ? 'pointer' : 'not-allowed',
            }}>
            Find help →
          </button>
        </div>
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

        {/* Text fallback toggle — only on idle, excluded from tab order (voice is primary) */}
        {(kioskState === 'idle' || kioskState === 'done') && (
          <button
            tabIndex={-1}
            onClick={() => { clearTranscript(); setTypedText(''); setKioskState('typing'); }}
            className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 px-5 py-2.5 rounded-full transition-all"
            style={{
              color: 'rgba(114,200,226,0.30)',
              border: '1px solid rgba(56,174,210,0.10)',
              background: 'rgba(26,147,187,0.04)',
              fontSize: '0.8rem',
            }}>
            ⌨️ Can't speak? Type instead
          </button>
        )}
      </div>
    </div>
  );
}
