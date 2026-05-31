import { useState, useEffect, useRef } from 'react';
import api from '../../api/client';
import { KIOSK_HUBS, KIOSK_DEFAULT_HUB, VOICE_SESSION_IDLE_MS, VOICE_MIN_CHARS } from '../../config';
import type { KioskSessionResponse, KioskRouteResponse, KioskReserveResponse, ItineraryResult, Hospital, HospitalsResponse } from '../../types/api';
import { cLog, cWarn } from '../../lib/clientLog';
import { useSpeech }       from '../shared/useSpeech';
import { VoiceOrb }        from './VoiceOrb';
import { EligibilityFlow } from './EligibilityFlow';
import { KioskItinerary }  from './KioskItinerary';
import { ReservationCode } from './ReservationCode';
import { CrisisHospitals } from './CrisisHospitals';
import { HavenMatrixLogo } from '../shared/HavenMatrixLogo';
import { MuteButton }      from '../shared/MuteButton';

type KioskState =
  | 'idle' | 'hub_select' | 'recording'
  | 'processing' | 'eligibility' | 'routing'
  | 'speaking' | 'crisis' | 'typing' | 'done'
  | 'reserving' | 'reservation_done';

const HUB_NAMES = Object.keys(KIOSK_HUBS);

export function KioskPage() {
  const {
    speak, startListening, stopListening, transcript, clearTranscript,
    startRecording, stopRecording, transcribeAudio, stopSpeaking,
    muted, toggleMute,
  } = useSpeech();
  const [kioskState,        setKioskState]        = useState<KioskState>('idle');
  const [hubName,           setHubName]           = useState<string>(KIOSK_DEFAULT_HUB);
  const [sessionId,         setSessionId]         = useState<string | null>(null);
  const [questions,         setQuestions]         = useState<string[]>([]);
  const [routeResult,       setRouteResult]       = useState<KioskRouteResponse | null>(null);
  const [reservation,       setReservation]       = useState<KioskReserveResponse | null>(null);
  const [crisisHotline,     setCrisisHotline]     = useState<string | null>(null);
  const [crisisText,        setCrisisText]        = useState<string | null>(null);
  const [crisisCategory,    setCrisisCategory]    = useState<string>('');
  const [crisisHospitals,   setCrisisHospitals]   = useState<Hospital[] | null>(null);
  const [typedText,         setTypedText]         = useState('');
  const [error,             setError]             = useState<string | null>(null);
  // Saved for intelligent re-route after location change from results screen
  const [lastAnswers,       setLastAnswers]       = useState<Record<string, boolean | string | null>>({});
  const [lastTranscript,    setLastTranscript]    = useState<string>('');
  // Which state triggered hub_select — controls heading text, cancel target, and re-route logic
  const [hubSelectFrom,     setHubSelectFrom]     = useState<KioskState>('idle');
  // Pending (highlighted-but-not-committed) hub in the selector — lets a user
  // correct an accidental tap before it triggers a re-route.
  const [pendingHub,        setPendingHub]        = useState<string>(KIOSK_DEFAULT_HUB);

  const idleTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kioskStateRef    = useRef<KioskState>('idle');
  // Latest hospitals, for the TTS chain in enterCrisis (avoids stale closure).
  const crisisHospRef    = useRef<Hospital[] | null>(null);
  const hubCoords      = KIOSK_HUBS[hubName] ?? KIOSK_HUBS[KIOSK_DEFAULT_HUB];

  useEffect(() => { kioskStateRef.current = kioskState; }, [kioskState]);

  // Clear idle timer on unmount to prevent setState on dead component
  useEffect(() => () => { if (idleTimerRef.current) clearTimeout(idleTimerRef.current); }, []);

  const resetIdle = () => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      // Never interrupt active operations, typing mid-input, or the reservation
      // code screen (user may still be reading / printing their code).
      const noInterrupt = ['eligibility', 'routing', 'processing', 'typing', 'done', 'reserving', 'reservation_done'];
      if (noInterrupt.includes(kioskStateRef.current)) return;
      window.speechSynthesis.cancel();
      setKioskState('idle');
      setSessionId(null);
      setQuestions([]);
      setRouteResult(null);
      setReservation(null);
      setLastTranscript('');
      setLastAnswers({});
    }, VOICE_SESSION_IDLE_MS);
  };

  // Start a fresh idle window whenever the typing screen opens so the timer is
  // measured from when typing begins, not from when the previous recording started.
  useEffect(() => {
    if (kioskState === 'typing') resetIdle();
  }, [kioskState]);

  useEffect(() => {
    if (kioskState === 'idle') {
      const timer = setTimeout(() => {
        speak("Welcome. I'm here to help you find shelter, food, or care. Tap the button and tell me what you need.");
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [kioskState]);

  // Open the hub selector, remembering which state triggered it
  const openHubSelect = (fromState: KioskState) => {
    // Kill audio and clear any error toast before showing the hub selector.
    stopSpeaking();
    stopListening();
    setError(null);
    if (fromState === 'recording') {
      stopRecording();   // discard in-progress audio
    }
    setHubSelectFrom(fromState);
    setPendingHub(hubName);   // start with the current location highlighted
    setKioskState('hub_select');
  };

  // Single clean path into the text fallback from any voice screen. Tears down
  // TTS, recognition, and any in-progress recording so no mic is left open.
  const switchToTyping = async () => {
    cLog('typing.switch', { from: kioskStateRef.current });
    stopSpeaking();
    stopListening();
    await stopRecording();   // discard any in-progress audio blob
    clearTranscript();
    setError(null);
    setTypedText('');
    setKioskState('typing');
  };

  // Single entry into the crisis screen. Speaks the escalation immediately and,
  // for medical emergencies, fetches the nearest hospitals (public ERs + private
  // clinics) and names the closest ER once the 9-1-1 guidance finishes.
  const enterCrisis = (
    data: { crisis_hotline?: string | null; escalation_text?: string | null; crisis_category?: string | null },
    coords: [number, number],
  ) => {
    const cat = data.crisis_category ?? '';
    const esc = data.escalation_text ?? 'Please call for crisis support.';
    setCrisisHotline(data.crisis_hotline ?? '988');
    setCrisisText(esc);
    setCrisisCategory(cat);
    setCrisisHospitals(null);
    crisisHospRef.current = null;
    setKioskState('crisis');

    if (cat === 'medical') {
      api.get<HospitalsResponse>('/hospitals/nearby', {
        params: { lat: coords[0], lon: coords[1], limit: 6 },
      }).then(r => {
        setCrisisHospitals(r.data.hospitals);
        crisisHospRef.current = r.data.hospitals;
      }).catch(() => {
        setCrisisHospitals([]);
        crisisHospRef.current = [];
      });
      speak(esc, () => {
        const er = crisisHospRef.current?.find(h => h.emergency);
        if (er) speak(`The closest emergency room is ${er.name}, about ${er.distance_drive_min} minutes away by car.`);
      });
    } else {
      speak(esc);
    }
  };

  const handleOrbTap = async () => {
    if (kioskState === 'idle' || kioskState === 'done') {
      stopSpeaking();
      // Force-reset recognition state — guards against wantListeningRef stuck true
      // from a previous session (e.g. eligibility flow that wasn't fully cleaned up).
      stopListening();
      setError(null);
      clearTranscript();
      // Give speaker echo time to die before opening the mic (500ms is safer than 250ms
      // on real kiosk hardware where speaker and mic share the same enclosure).
      await new Promise(r => setTimeout(r, 500));
      startListening(true);
      await startRecording();
      cLog('recording.start', { hub: hubName });
      setKioskState('recording');
      resetIdle();
      return;
    }

    if (kioskState !== 'recording') return;
    stopListening();
    setKioskState('processing');

    const blob = await stopRecording();
    let captured = '';
    let transcriptSource = 'none';
    if (blob && blob.size > 0) {
      const asrText = await transcribeAudio(blob);
      if (asrText) { captured = asrText; transcriptSource = 'asr_nim'; }
    }
    if (!captured) { captured = transcript; transcriptSource = captured ? 'web_speech' : 'none'; }

    cLog('recording.stop', { chars: captured.length, source: transcriptSource, hub: hubName });

    if (!captured || captured.trim().length < VOICE_MIN_CHARS) {
      cWarn('recording.too_short', { chars: captured.length, source: transcriptSource });
      speak(
        "Sorry, I couldn't hear that clearly. Tap the button to try again, or tap the keyboard icon below to type instead.",
        () => { switchToTyping(); },
      );
      setKioskState('done');
      return;
    }

    setLastTranscript(captured);

    try {
      const r = await api.post<KioskSessionResponse>('/kiosk/session', {
        transcript:  captured,
        origin_lat:  hubCoords[0],
        origin_lon:  hubCoords[1],
      });
      if (r.data.next_step === 'crisis') {
        cLog('session.crisis', { category: r.data.crisis_category });
        enterCrisis(r.data, hubCoords);
        return;
      }
      cLog('session.created', {
        session_id:      r.data.session_id,
        next_step:       r.data.next_step,
        questions_count: r.data.eligibility_questions.length,
      });
      setSessionId(r.data.session_id);
      if (r.data.next_step === 'collect_eligibility' && r.data.eligibility_questions.length > 0) {
        setQuestions(r.data.eligibility_questions);
        setKioskState('eligibility');
      } else {
        setLastAnswers({});
        await submitRoute(r.data.session_id!, {});
      }
    } catch {
      cWarn('session.error');
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
      // Log which pillars were returned and top distances for analysis
      const summary = Object.entries(r.data.itinerary)
        .filter(([, results]) => results.length > 0)
        .map(([pillar, results]) => ({ pillar, name: results[0].name, km: results[0].distance_km }));
      cLog('route.result', { pillars: summary.map(s => s.pillar), top: summary, solve_ms: r.data.gpu_solve_ms });
      setKioskState('speaking');
    } catch {
      const msg = "I'm sorry, I wasn't able to find anything right now. You can also call 2-1-1 for help.";
      setError(msg);
      speak(msg, () => { setError(null); setKioskState('idle'); });
    }
  };

  const onEligibilityComplete = (answers: Record<string, boolean | string | null>) => {
    setLastAnswers(answers);
    if (sessionId) submitRoute(sessionId, answers);
  };

  const handleReserve = async (result: ItineraryResult, pillar: string) => {
    if (!sessionId) return;
    setKioskState('reserving');
    try {
      const r = await api.post<KioskReserveResponse>('/kiosk/reserve', {
        session_id:       sessionId,
        facility_name:    result.name,
        facility_address: result.address,
        pillar,
      });
      setReservation(r.data);
      setKioskState('reservation_done');
    } catch {
      const msg = "I wasn't able to make the reservation. Please go directly to the shelter.";
      // Use setKioskState directly in onEnd — avoids a stale-closure race where the
      // user could reset to idle before TTS ends, then the callback revives 'speaking'.
      // Speaking state is only restored if routeResult is still populated.
      speak(msg, () => {
        setKioskState(prev => (prev === 'reserving' || prev === 'idle') && routeResult ? 'speaking' : prev);
      });
    }
  };

  const submitText = async (text: string) => {
    if (text.trim().length < VOICE_MIN_CHARS) return;
    setError(null);
    setLastTranscript(text.trim());
    setKioskState('processing');
    try {
      const r = await api.post<KioskSessionResponse>('/kiosk/session', {
        transcript: text.trim(),
        origin_lat: hubCoords[0],
        origin_lon: hubCoords[1],
      });
      if (r.data.next_step === 'crisis') {
        enterCrisis(r.data, hubCoords);
        return;
      }
      setSessionId(r.data.session_id);
      if (r.data.next_step === 'collect_eligibility' && r.data.eligibility_questions.length > 0) {
        setQuestions(r.data.eligibility_questions);
        setKioskState('eligibility');
      } else {
        setLastAnswers({});
        await submitRoute(r.data.session_id!, {});
      }
    } catch {
      const msg = "Sorry, something went wrong. Please try again.";
      setError(msg);
      speak(msg, () => { setError(null); setKioskState('typing'); });
    }
  };

  // Commit a hub the user has confirmed (not just tapped). Intelligent routing:
  // • From 'speaking': re-run the same request from the new location (no re-speaking needed)
  // • From 'typing':   return to typing screen with new coords applied at submit time
  // • From anything else: reset to idle at the new location
  const commitHub = async (name: string) => {
    const newCoords = KIOSK_HUBS[name] as [number, number] ?? hubCoords;
    setHubName(name);

    if (hubSelectFrom === 'speaking' && lastTranscript) {
      // Re-run the original request from the new hub
      setKioskState('routing');
      try {
        const r = await api.post<KioskSessionResponse>('/kiosk/session', {
          transcript:  lastTranscript,
          origin_lat:  newCoords[0],
          origin_lon:  newCoords[1],
        });
        if (r.data.next_step === 'crisis') {
          enterCrisis(r.data, newCoords);
          return;
        }
        const newSid = r.data.session_id!;
        setSessionId(newSid);
        // Skip re-asking eligibility — use previously collected answers
        await submitRoute(newSid, lastAnswers);
      } catch {
        speak(
          "Location updated. Tap the button to search again.",
          () => { setKioskState('idle'); setSessionId(null); setRouteResult(null); },
        );
      }
      return;
    }

    if (hubSelectFrom === 'typing') {
      // Stay on typing screen — coords will be used when they submit
      setKioskState('typing');
      return;
    }

    // Default: reset to idle at new location — clear all session and error state
    setKioskState('idle');
    setSessionId(null);
    setRouteResult(null);
    setReservation(null);
    setQuestions([]);
    setLastTranscript('');
    setLastAnswers({});
    setError(null);
  };

  // ── Hub selector ──────────────────────────────────────────────────────────────
  if (kioskState === 'hub_select' || (kioskState === 'idle' && !hubName)) {
    const isReroute  = hubSelectFrom === 'speaking';
    const fromTyping = hubSelectFrom === 'typing';
    const cancelTarget = isReroute ? 'speaking' : fromTyping ? 'typing' : 'idle';

    return (
      <div className="min-h-screen flex flex-col items-center justify-start px-6 py-10"
        style={{ background: 'linear-gradient(160deg, #0A1E2E 0%, #0D2436 60%, #061825 100%)' }}>

        <div className="flex items-center gap-2 mb-2">
          <HavenMatrixLogo size={22} />
          <span className="text-xs font-medium tracking-widest uppercase"
            style={{ color: 'rgba(114,200,226,0.55)' }}>Haven Matrix</span>
        </div>

        <h1 className="text-3xl font-light mb-1 mt-4 text-center"
          style={{ color: 'rgba(114,200,226,0.9)' }}>
          {isReroute ? 'Change location' : 'Where are you right now?'}
        </h1>
        <p className="text-sm mb-8 text-center"
          style={{ color: 'rgba(255,255,255,0.3)' }}>
          {isReroute
            ? "We'll re-search from the new location — no need to repeat yourself"
            : 'Tap your nearest location, then press Confirm'}
        </p>

        <div className="w-full max-w-lg grid grid-cols-2 gap-3">
          {HUB_NAMES.map(name => {
            const isSelected = name === pendingHub;
            return (
              <button
                key={name}
                onClick={() => setPendingHub(name)}
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

        {/* Confirm + Back — tapping a tile only highlights it; nothing commits
            (and no re-route fires) until the user confirms, so an accidental
            wrong tap is harmless. */}
        <div className="w-full max-w-lg mt-8 flex flex-col gap-3">
          <button
            onClick={() => { if (pendingHub) commitHub(pendingHub); }}
            disabled={!pendingHub}
            className="w-full py-4 rounded-2xl text-lg font-semibold transition-all"
            style={{
              background: pendingHub ? 'linear-gradient(135deg, #1A7A9A, #38AED2)' : 'rgba(255,255,255,0.05)',
              color:      pendingHub ? 'white' : 'rgba(255,255,255,0.25)',
              border:     pendingHub ? 'none' : '1px solid rgba(255,255,255,0.08)',
              cursor:     pendingHub ? 'pointer' : 'not-allowed',
            }}>
            {isReroute
              ? `Search from ${pendingHub || '…'} →`
              : pendingHub ? `Confirm — ${pendingHub}` : 'Pick a location above'}
          </button>

          {hubName && kioskState === 'hub_select' && (
            <button
              onClick={() => setKioskState(cancelTarget)}
              className="w-full text-sm font-light py-3 rounded-xl"
              style={{ color: 'rgba(114,200,226,0.45)', border: '1px solid rgba(26,147,187,0.15)' }}>
              ← Back{isReroute ? ' — keep current location' : ''}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Reservation code screen ───────────────────────────────────────────────────
  if (kioskState === 'reservation_done' && reservation) {
    return (
      <ReservationCode
        reservation={reservation}
        onReset={() => {
          setKioskState('idle');
          setRouteResult(null);
          setReservation(null);
          setSessionId(null);
          setLastAnswers({});
          setLastTranscript('');
        }}
      />
    );
  }

  // ── Reserving (brief processing state) ───────────────────────────────────────
  if (kioskState === 'reserving') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center"
        style={{ background: 'linear-gradient(160deg, #0A1E2E 0%, #0D2436 60%, #061825 100%)' }}>
        <div className="flex flex-col items-center gap-6">
          <div className="flex items-center gap-1.5 h-10">
            {[0,1,2,3,4].map(i => (
              <div key={i} className="w-1.5 rounded-full animate-wave"
                style={{ height: 28, background: '#38AED2', opacity: 0.7, animationDelay: `${i * 0.12}s` }} />
            ))}
          </div>
          <p className="text-2xl font-light" style={{ color: 'rgba(114,200,226,0.9)' }}>
            Making your reservation…
          </p>
        </div>
      </div>
    );
  }

  // ── Results screen — wrap KioskItinerary with a persistent location chip ──────
  if (kioskState === 'speaking' && routeResult) {
    return (
      <div className="relative">
        {/* Floating location chip — more prominent here since re-route is the key action */}
        <button
          onClick={() => openHubSelect('speaking')}
          className="fixed top-4 left-4 z-50 flex items-center gap-1.5 px-3 py-2 rounded-full transition-all"
          style={{
            background: 'rgba(26,147,187,0.22)',
            border: '1px solid rgba(56,174,210,0.45)',
            backdropFilter: 'blur(8px)',
          }}>
          <span className="text-xs">📍</span>
          <span className="text-xs font-semibold tracking-wide" style={{ color: '#72C8E2' }}>
            {hubName}
          </span>
          <span className="text-xs font-medium" style={{ color: 'rgba(114,200,226,0.5)' }}>
            › change
          </span>
        </button>

        <MuteButton muted={muted} onToggle={toggleMute} className="fixed top-4 right-4 z-50" />

        <KioskItinerary
          itinerary={routeResult.itinerary}
          ttsScript={routeResult.tts_script}
          heardText={lastTranscript}
          originLat={hubCoords[0]}
          originLon={hubCoords[1]}
          hubName={hubName}
          onReserve={handleReserve}
          onReset={() => {
            setKioskState('idle');
            setRouteResult(null);
            setSessionId(null);
            setLastAnswers({});
            setLastTranscript('');
          }}
        />
      </div>
    );
  }

  // ── Crisis screen ─────────────────────────────────────────────────────────────
  if (kioskState === 'crisis') {
    const isMedical = crisisCategory === 'medical';
    const resetCrisis = () => {
      stopSpeaking();
      setKioskState('idle');
      setCrisisHotline(null); setCrisisText(null); setCrisisCategory('');
      setCrisisHospitals(null); crisisHospRef.current = null;
      // Reset all session state so a re-record starts completely fresh
      setSessionId(null); setQuestions([]); setLastAnswers({}); setLastTranscript('');
    };
    return (
      <div className="min-h-screen flex flex-col items-center px-6 py-10 overflow-y-auto"
        style={{ background: 'linear-gradient(160deg, #0A1E2E 0%, #1A0A0A 100%)' }}>
        <MuteButton muted={muted} onToggle={toggleMute} className="fixed top-4 right-4 z-50" />
        <div className="text-5xl mb-4 mt-2">🆘</div>
        <h2 className="text-3xl font-light mb-3 text-center" style={{ color: 'rgba(255,200,100,0.9)' }}>
          Help is available
        </h2>
        <p className="text-lg font-light leading-relaxed max-w-lg mb-6 text-center"
          style={{ color: 'rgba(255,255,255,0.8)' }}>
          {crisisText}
        </p>

        {/* Tap-to-call the emergency line */}
        <a
          href={`tel:${(crisisHotline ?? '911').replace(/[^0-9+]/g, '')}`}
          className="flex flex-col items-center px-12 py-4 rounded-2xl mb-8"
          style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.45)' }}>
          <span className="text-xs uppercase tracking-widest font-semibold" style={{ color: 'rgba(251,191,36,0.7)' }}>
            Tap to call
          </span>
          <span className="text-5xl font-bold" style={{ color: '#FBBF24' }}>{crisisHotline}</span>
        </a>

        {/* Medical emergencies: nearest public ERs + private clinics */}
        {isMedical && <CrisisHospitals hospitals={crisisHospitals} />}

        <button
          onClick={resetCrisis}
          className="mt-8 mb-4 text-lg font-light px-8 py-4 rounded-2xl transition-all"
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

  // ── Typing / text fallback ────────────────────────────────────────────────────
  if (kioskState === 'typing') {
    const ready = typedText.trim().length >= VOICE_MIN_CHARS;
    return (
      <div className="min-h-screen flex flex-col"
        style={{ background: 'linear-gradient(160deg, #0A1E2E 0%, #0D2436 60%, #061825 100%)' }}>

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

          {/* Location chip — interactive in typing mode */}
          <button
            onClick={() => openHubSelect('typing')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all"
            style={{
              color: 'rgba(114,200,226,0.65)',
              background: 'rgba(26,147,187,0.08)',
              border: '1px solid rgba(56,174,210,0.18)',
            }}>
            <span className="text-xs">📍</span>
            <span className="text-xs font-medium">{hubName}</span>
            <span className="text-xs" style={{ color: 'rgba(114,200,226,0.35)' }}>›</span>
          </button>
        </div>

        <div className="px-6 pt-4 pb-6">
          <h2 className="text-3xl font-light mb-2" style={{ color: 'rgba(255,255,255,0.90)' }}>
            Tell us what you need
          </h2>
          <p className="text-base" style={{ color: 'rgba(255,255,255,0.35)' }}>
            Describe your situation — shelter, food, support, or anything else
          </p>
        </div>

        <div className="flex-1 px-6">
          <textarea
            value={typedText}
            onChange={e => { setTypedText(e.target.value); resetIdle(); }}
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

  // ── Eligibility questions ─────────────────────────────────────────────────────
  if (kioskState === 'eligibility') {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: 'linear-gradient(160deg, #0A1E2E, #0D2436)' }}>
        <EligibilityFlow
          questions={questions}
          heardText={lastTranscript}
          onComplete={onEligibilityComplete}
          onSkip={() => sessionId && submitRoute(sessionId, {})}
          onType={switchToTyping}
        />
      </div>
    );
  }

  // ── Main orb screen (idle / recording / processing / routing / done) ──────────
  const orbState = (
    kioskState === 'recording'  ? 'listening'  :
    kioskState === 'processing' ? 'processing' :
    kioskState === 'routing'    ? 'processing' :
    'idle'
  );

  const chipInteractive = kioskState === 'idle' || kioskState === 'done';

  return (
    <div className="min-h-screen flex flex-col relative"
      style={{ background: 'linear-gradient(160deg, #0A1E2E 0%, #0D2436 50%, #061825 100%)' }}>

      {/* Location chip */}
      <button
        onClick={() => chipInteractive && openHubSelect('idle')}
        className="absolute top-4 left-4 flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all"
        style={{
          background: 'rgba(26,147,187,0.10)',
          border: '1px solid rgba(56,174,210,0.20)',
          cursor: chipInteractive ? 'pointer' : 'default',
          opacity: chipInteractive ? 1 : 0.45,
        }}>
        <span className="text-xs" style={{ color: 'rgba(114,200,226,0.55)' }}>📍</span>
        <span className="text-xs font-medium tracking-wide" style={{ color: 'rgba(114,200,226,0.55)' }}>
          {hubName}
        </span>
        {chipInteractive && (
          <span className="text-xs" style={{ color: 'rgba(114,200,226,0.30)' }}>›</span>
        )}
      </button>

      {/* Haven Matrix wordmark */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2">
        <HavenMatrixLogo size={22} />
        <span className="text-xs font-medium tracking-widest uppercase"
          style={{ color: 'rgba(114,200,226,0.55)' }}>
          Haven Matrix
        </span>
      </div>

      {/* Mute toggle */}
      <MuteButton muted={muted} onToggle={toggleMute} className="absolute top-4 right-4 z-50" />

      {error && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 rounded-xl px-5 py-2.5 text-sm font-medium"
          style={{ background: 'rgba(26,147,187,0.15)', border: '1px solid rgba(56,174,210,0.3)', color: '#AADEED' }}>
          {error}
        </div>
      )}

      <div className="flex-1 relative">
        <VoiceOrb state={orbState} onClick={handleOrbTap} />

        {/* Live transcript while the mic is open */}
        {kioskState === 'recording' && transcript && (
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 w-full max-w-sm px-6 text-center pointer-events-none">
            <p className="text-xl font-light leading-relaxed" style={{ color: 'rgba(114,200,226,0.85)' }}>
              {transcript}
            </p>
          </div>
        )}

        {/* Captured transcript persists through processing + routing so the
            person can confirm what the kiosk heard while they wait. */}
        {(kioskState === 'processing' || kioskState === 'routing') && lastTranscript && (
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 w-full max-w-sm px-6 text-center pointer-events-none">
            <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(114,200,226,0.45)' }}>
              You said
            </p>
            <p className="text-lg font-light leading-relaxed" style={{ color: 'rgba(114,200,226,0.8)' }}>
              “{lastTranscript}”
            </p>
          </div>
        )}

        {(kioskState === 'idle' || kioskState === 'done') && (
          <button
            tabIndex={-1}
            onClick={switchToTyping}
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

        {/* Escape hatch while recording — bail to typing without finishing the take.
            tabIndex={-1} keeps Tab on the VoiceOrb (AGENTS.md Rule 6). Shown only in
            'recording' (not 'processing') to avoid racing an in-flight session request. */}
        {kioskState === 'recording' && (
          <button
            tabIndex={-1}
            onClick={switchToTyping}
            className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 px-5 py-2.5 rounded-full transition-all"
            style={{
              color: 'rgba(114,200,226,0.30)',
              border: '1px solid rgba(56,174,210,0.10)',
              background: 'rgba(26,147,187,0.04)',
              fontSize: '0.8rem',
            }}>
            ⌨️ Type instead
          </button>
        )}
      </div>
    </div>
  );
}
