import { useEffect, useState, useRef } from 'react';
import { useSpeech } from '../shared/useSpeech';
import { VoiceOrb }  from './VoiceOrb';
import { VOICE_ELIGIBILITY_WAIT_SEC } from '../../config';
import { cLog, cWarn } from '../../lib/clientLog';

interface Props {
  questions:  string[];
  onComplete: (answers: Record<string, boolean | string | null>) => void;
  onSkip:     () => void;
  onType:     () => void;
}

type FlowState = 'speaking_question' | 'waiting_for_answer' | 'complete';

function questionHint(q: string): string {
  const ql = q.toLowerCase();
  if (ql.includes('24') || ql.includes('younger'))       return "Say:  yes  ·  no";
  if (ql.includes("men's") || ql.includes("women's"))    return "Say:  men's  ·  women's  ·  any";
  if (ql.includes(' id ') || ql.endsWith(' id?'))        return "Say:  yes  ·  no";
  if (ql.includes('drink') || ql.includes('used'))       return "Say:  yes  ·  no";
  if (ql.includes('family') || ql.includes('children'))  return "Say:  alone  ·  with family";
  return "Speak your answer";
}

function parseAnswer(question: string, answer: string): { key: string; value: string | boolean | null } {
  const t = answer.toLowerCase();
  const q = question.toLowerCase();

  if (q.includes('24') || q.includes('younger')) {
    if (/yes|yeah|yep|under|young|teen/.test(t))               return { key: 'sector', value: 'youth' };
    if (/no|nope|older|over|adult|not young|i'm not/.test(t))  return { key: 'sector', value: 'adult' };
    return { key: 'sector', value: null };
  }

  if (q.includes("men's shelter") || q.includes("women's shelter") || q.includes('any available bed')) {
    if (/women|woman|female|ladies|lady|girl/.test(t))                               return { key: 'gender', value: 'female' };
    if (/\bmen\b|\bman\b|\bmale\b|guys|guy/.test(t))                                 return { key: 'gender', value: 'male' };
    if (/any|either|doesn't matter|don't mind|both|non.?binary|trans|whatever/.test(t)) return { key: 'gender', value: null };
    return { key: 'gender', value: null };
  }

  if (q.includes('id')) {
    if (/yes|yeah|yep|have it|got it|i do/.test(t)) return { key: 'has_id', value: true };
    if (/no|nope|don't have|lost|haven't/.test(t))  return { key: 'has_id', value: false };
    return { key: 'has_id', value: null };
  }

  if (q.includes('drink') || q.includes('used')) {
    if (/yes|yeah|yep|have been|little bit|bit/.test(t)) return { key: 'sobriety_status', value: 'using' };
    if (/no|nope|sober|clean|haven't/.test(t))           return { key: 'sobriety_status', value: 'sober' };
    return { key: 'sobriety_status', value: null };
  }

  if (q.includes('family') || q.includes('children')) {
    if (/family|kids|children|baby|wife|husband|partner/.test(t)) return { key: 'group_size', value: 'with_family' };
    if (/alone|myself|just me|on my own|solo/.test(t))             return { key: 'group_size', value: 'alone' };
    return { key: 'group_size', value: null };
  }

  return { key: 'unknown', value: null };
}

export function EligibilityFlow({ questions, onComplete, onSkip, onType }: Props) {
  const {
    speak, startListening, stopListening, stopSpeaking,
    transcript, transcriptFinal, clearTranscript,
  } = useSpeech();

  const [idx,       setIdx]       = useState(0);
  const [flowState, setFlowState] = useState<FlowState>('speaking_question');
  const answers     = useRef<Record<string, boolean | string | null>>({});
  // Abandonment guard — fires only after the user has been inactive (no speech,
  // no tap) for VOICE_ELIGIBILITY_WAIT_SEC. Re-armed on every transcript change.
  const timeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef  = useRef(true);
  // Guards against the inactivity guard and a tap firing together.
  const didAdvanceRef   = useRef(false);

  const advanceOrComplete = (i: number, answer: string | null, trigger = 'unknown') => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    stopListening();

    let parsed = { key: 'unknown', value: null as string | boolean | null };
    if (answer !== null && answer.trim().length > 0) {
      parsed = parseAnswer(questions[i], answer);
      if (parsed.key !== 'unknown') {
        answers.current[parsed.key] = parsed.value;
      }
    }

    cLog('eligibility.answer', {
      q_index:   i,
      q_type:    questionHint(questions[i]).replace('Say:  ', '').slice(0, 40),
      raw:       answer ?? '(none)',
      parsed_key:   parsed.key,
      parsed_value: String(parsed.value),
      trigger,   // 'tap' (normal) | 'inactivity' (walked away) | 'unknown' (tts fallback)
    });

    const next = i + 1;
    if (next < questions.length) {
      setIdx(next);
      speakQuestion(next);
    } else {
      cLog('eligibility.complete', { total_questions: questions.length, answers_collected: Object.keys(answers.current).length });
      setFlowState('complete');
      onComplete(answers.current);
    }
  };

  const speakQuestion = (i: number) => {
    didAdvanceRef.current = false;
    setFlowState('speaking_question');
    cLog('eligibility.question', { index: i, total: questions.length, type: questionHint(questions[i]).replace('Say:  ', '').slice(0, 40) });

    // Safety net: if TTS never fires onend/onerror (browser engine locked or no voices
    // loaded), auto-advance after 8s so the flow doesn't hang silently.
    const ttsFallback = setTimeout(() => {
      if (!mountedRef.current || didAdvanceRef.current) return;
      didAdvanceRef.current = true;
      advanceOrComplete(i, null);
    }, 8_000);

    speak(questions[i], () => {
      clearTimeout(ttsFallback);
      if (!mountedRef.current) return;
      setFlowState('waiting_for_answer');
      clearTranscript();
      // Continuous: the mic stays open and never auto-stops on a pause. The user
      // taps the orb to confirm their answer (tap-to-confirm) — see the orb onClick
      // and the inactivity guard effect below.
      startListening(true);
    });
  };

  useEffect(() => {
    // Reset on (re)mount — React StrictMode remounts in dev without recreating
    // refs, so without this mountedRef stays false after the first cycle and the
    // flow can never advance.
    mountedRef.current = true;
    speakQuestion(0);
    return () => {
      mountedRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      stopListening();
      stopSpeaking();
    };
  }, []);

  // ── Abandonment guard (NOT an interruption).
  // While waiting for an answer, arm a timer that fires only after the user has
  // been inactive for VOICE_ELIGIBILITY_WAIT_SEC. Re-runs (resetting the timer)
  // on every transcript change, so an actively-speaking user is never cut off —
  // it only catches someone who walked away. Normal advance is the orb tap.
  useEffect(() => {
    if (flowState !== 'waiting_for_answer' || didAdvanceRef.current) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (!mountedRef.current || didAdvanceRef.current) return;
      didAdvanceRef.current = true;
      const best = transcriptFinal.length >= 2
        ? transcriptFinal
        : transcript.length >= 2 ? transcript : null;
      cWarn('eligibility.inactivity', { q_index: idx, had_answer: best !== null });
      advanceOrComplete(idx, best, 'inactivity');
    }, VOICE_ELIGIBILITY_WAIT_SEC * 1000);
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [flowState, transcript, transcriptFinal, idx]);

  const orbState = flowState === 'speaking_question' ? 'speaking'
    : flowState === 'waiting_for_answer' ? 'listening'
    : 'processing';

  const currentQ = questions[idx] ?? '';

  return (
    <div className="min-h-screen flex flex-col px-5 py-6"
      style={{ background: 'linear-gradient(160deg, #0A1E2E 0%, #0D2436 60%, #061825 100%)' }}>

      {/* ── Header row: progress + skip ── */}
      <div className="flex items-center justify-between mb-6">
        <span className="text-sm font-medium px-3 py-1.5 rounded-full"
          style={{ background: 'rgba(26,147,187,0.12)', color: 'rgba(114,200,226,0.65)', border: '1px solid rgba(56,174,210,0.2)' }}>
          Question {idx + 1} of {questions.length}
        </span>
        <div className="flex items-center gap-2">
          <button
            tabIndex={-1}
            onClick={() => {
              cLog('eligibility.type', { q_index: idx });
              if (timeoutRef.current) clearTimeout(timeoutRef.current);
              didAdvanceRef.current = true;
              stopListening();
              stopSpeaking();
              onType();
            }}
            className="text-sm font-medium px-3 py-1.5 rounded-full transition-all"
            style={{ color: 'rgba(114,200,226,0.55)', border: '1px solid rgba(56,174,210,0.18)', background: 'rgba(26,147,187,0.08)' }}>
            ⌨️ Type instead
          </button>
          <button
            onClick={() => { cLog('eligibility.skip', { q_index: idx }); if (timeoutRef.current) clearTimeout(timeoutRef.current); didAdvanceRef.current = true; stopListening(); onSkip(); }}
            className="text-sm font-medium px-3 py-1.5 rounded-full transition-all"
            style={{ color: 'rgba(114,200,226,0.4)', border: '1px solid rgba(56,174,210,0.12)', background: 'transparent' }}>
            Skip →
          </button>
        </div>
      </div>

      {/* ── Question card ── */}
      <div className="rounded-2xl px-5 py-4 mb-2"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(56,174,210,0.18)' }}>
        <p className="text-xl font-light leading-relaxed" style={{ color: 'rgba(255,255,255,0.90)' }}>
          {currentQ}
        </p>
      </div>

      {/* ── Orb ── */}
      <div className="flex-1 flex flex-col items-center justify-center">
        <VoiceOrb
          state={orbState}
          onClick={() => {
            if (flowState === 'waiting_for_answer' && !didAdvanceRef.current) {
              didAdvanceRef.current = true;
              advanceOrComplete(idx, transcriptFinal.length >= 2 ? transcriptFinal : transcript || null, 'tap');
            }
          }}
        />
      </div>

      {/* ── Live transcript ── */}
      <div className="min-h-[3rem] flex items-center justify-center px-4 mb-2">
        {flowState === 'waiting_for_answer' && transcript && (
          <p className="text-xl font-light text-center"
            style={{ color: 'rgba(114,200,226,0.85)' }}>
            💬 "{transcript}"
          </p>
        )}
        {flowState === 'speaking_question' && (
          <p className="text-sm text-center"
            style={{ color: 'rgba(255,255,255,0.25)' }}>
            Get ready to answer…
          </p>
        )}
      </div>

      {/* ── Hint ── */}
      {flowState === 'waiting_for_answer' && (
        <div className="pb-2">
          <p className="text-sm text-center"
            style={{ color: 'rgba(114,200,226,0.38)', letterSpacing: '0.04em' }}>
            {questionHint(currentQ)}
          </p>
          <p className="text-xs text-center mt-1"
            style={{ color: 'rgba(114,200,226,0.28)', letterSpacing: '0.04em' }}>
            Take your time — tap the circle when you're done
          </p>
        </div>
      )}
    </div>
  );
}
