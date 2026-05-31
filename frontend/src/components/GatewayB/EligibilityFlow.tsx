import { useEffect, useState, useRef } from 'react';
import { useSpeech } from '../shared/useSpeech';
import { VoiceOrb }  from './VoiceOrb';
import { VOICE_ELIGIBILITY_WAIT_SEC } from '../../config';
import { cLog, cWarn } from '../../lib/clientLog';

interface Props {
  questions:  string[];
  onComplete: (answers: Record<string, boolean | string | null>) => void;
  onSkip:     () => void;
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

export function EligibilityFlow({ questions, onComplete, onSkip }: Props) {
  const {
    speak, startListening, stopListening,
    transcript, transcriptFinal, clearTranscript,
    isListening,
  } = useSpeech();

  const [idx,       setIdx]       = useState(0);
  const [flowState, setFlowState] = useState<FlowState>('speaking_question');
  const answers     = useRef<Record<string, boolean | string | null>>({});
  const timeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef  = useRef(true);
  // Prevents double-advance from the transcriptFinal effect + isListening effect firing together
  const didAdvanceRef   = useRef(false);
  // Tracks whether listening actually started for the current question
  const wasListeningRef = useRef(false);

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
      trigger,   // 'finalTranscript' | 'srEnded' | 'tap' | 'timeout' | 'tts_fallback'
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
    didAdvanceRef.current   = false;
    wasListeningRef.current = false;
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
      startListening(false);
      // Fallback timeout — fires if user never speaks and silence detection doesn't trigger
      timeoutRef.current = setTimeout(() => {
        if (!mountedRef.current || didAdvanceRef.current) return;
        cWarn('eligibility.timeout', { q_index: i });
        didAdvanceRef.current = true;
        advanceOrComplete(i, null, 'timeout');
      }, VOICE_ELIGIBILITY_WAIT_SEC * 1000);
    });
  };

  useEffect(() => {
    speakQuestion(0);
    return () => {
      mountedRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      stopListening();
      window.speechSynthesis.cancel();
    };
  }, []);

  // ── Trigger 1: advance when a FINAL result arrives (not interim)
  // 300ms debounce lets multi-word answers like "women's shelter" complete
  useEffect(() => {
    if (flowState !== 'waiting_for_answer' || transcriptFinal.length < 2 || didAdvanceRef.current) return;
    const t = setTimeout(() => {
      if (!mountedRef.current || didAdvanceRef.current) return;
      didAdvanceRef.current = true;
      advanceOrComplete(idx, transcriptFinal, 'finalTranscript');
    }, 300);
    return () => clearTimeout(t);
  }, [transcriptFinal]);

  // ── Trigger 2: advance when SR ends naturally (silence detection fired)
  // This catches short answers like "yes"/"no" where the final result may not
  // reach the threshold above before SR closes.
  useEffect(() => {
    if (isListening) {
      wasListeningRef.current = true;
      return;
    }
    if (!wasListeningRef.current) return;
    wasListeningRef.current = false;
    if (flowState !== 'waiting_for_answer' || didAdvanceRef.current || !mountedRef.current) return;
    // Use best available transcript: final preferred, fall back to live (interim)
    const best = transcriptFinal.length >= 2
      ? transcriptFinal
      : transcript.length >= 2 ? transcript : null;
    didAdvanceRef.current = true;
    advanceOrComplete(idx, best, 'srEnded');
  }, [isListening]);

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
        <button
          onClick={() => { cLog('eligibility.skip', { q_index: idx }); if (timeoutRef.current) clearTimeout(timeoutRef.current); stopListening(); onSkip(); }}
          className="text-sm font-medium px-3 py-1.5 rounded-full transition-all"
          style={{ color: 'rgba(114,200,226,0.4)', border: '1px solid rgba(56,174,210,0.12)', background: 'transparent' }}>
          Skip →
        </button>
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
        <p className="text-sm text-center pb-2"
          style={{ color: 'rgba(114,200,226,0.38)', letterSpacing: '0.04em' }}>
          {questionHint(currentQ)}
        </p>
      )}
    </div>
  );
}
