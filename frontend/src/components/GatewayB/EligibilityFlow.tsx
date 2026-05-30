import { useEffect, useState, useRef } from 'react';
import { useSpeech } from '../shared/useSpeech';
import { VoiceOrb }  from './VoiceOrb';
import { VOICE_ELIGIBILITY_WAIT_SEC } from './eligibilityConfig';

interface Props {
  questions:  string[];
  onComplete: (answers: Record<string, boolean | string | null>) => void;
  onSkip:     () => void;
}

type FlowState = 'speaking_question' | 'waiting_for_answer' | 'complete';

function parseAnswer(question: string, answer: string): { key: string; value: string | boolean | null } {
  const t = answer.toLowerCase();
  const q = question.toLowerCase();

  if (q.includes('id')) {
    const key = 'has_id';
    if (/yes|yeah|yep|have it|got it|i do/.test(t)) return { key, value: true };
    if (/no|nope|don't have|lost|haven't/.test(t))   return { key, value: false };
    return { key, value: null };
  }

  if (q.includes('drink') || q.includes('used')) {
    const key = 'sobriety_status';
    if (/yes|yeah|yep|have been|little bit|bit/.test(t)) return { key, value: 'using' };
    if (/no|nope|sober|clean|haven't/.test(t))           return { key, value: 'sober' };
    return { key, value: null };
  }

  if (q.includes('family') || q.includes('children')) {
    const key = 'group_size';
    if (/family|kids|children|baby|wife|husband|partner/.test(t)) return { key, value: 'with_family' };
    if (/alone|myself|just me|on my own|solo/.test(t))             return { key, value: 'alone' };
    return { key, value: null };
  }

  return { key: 'unknown', value: null };
}

export function EligibilityFlow({ questions, onComplete, onSkip }: Props) {
  const { speak, startListening, stopListening, transcript, clearTranscript } = useSpeech();
  const [idx,       setIdx]       = useState(0);
  const [flowState, setFlowState] = useState<FlowState>('speaking_question');
  const answers                   = useRef<Record<string, boolean | string | null>>({});
  const timeoutRef                = useRef<ReturnType<typeof setTimeout> | null>(null);

  const waitSec = VOICE_ELIGIBILITY_WAIT_SEC;

  const speakQuestion = (i: number) => {
    setFlowState('speaking_question');
    speak(questions[i], () => {
      setFlowState('waiting_for_answer');
      clearTranscript();
      startListening(false);
      timeoutRef.current = setTimeout(() => {
        stopListening();
        advanceOrComplete(i, null);
      }, waitSec * 1000);
    });
  };

  const advanceOrComplete = (i: number, answer: string | null) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    stopListening();

    if (answer !== null && answer.trim().length > 0) {
      const parsed = parseAnswer(questions[i], answer);
      answers.current[parsed.key] = parsed.value;
    }

    const next = i + 1;
    if (next < questions.length) {
      setIdx(next);
      speakQuestion(next);
    } else {
      setFlowState('complete');
      onComplete(answers.current);
    }
  };

  // Start first question on mount
  useEffect(() => {
    speakQuestion(0);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      window.speechSynthesis.cancel();
    };
  }, []);

  // When transcript changes and we're waiting for answer, submit it
  useEffect(() => {
    if (flowState === 'waiting_for_answer' && transcript.length > 3) {
      advanceOrComplete(idx, transcript);
    }
  }, [transcript, idx, flowState]);

  const orbState = flowState === 'speaking_question' ? 'speaking'
    : flowState === 'waiting_for_answer' ? 'listening'
    : 'processing';

  return (
    <VoiceOrb
      state={orbState}
      onPointerDown={() => {
        if (flowState === 'waiting_for_answer') {
          clearTranscript();
          startListening(false);
        }
      }}
      onPointerUp={() => {
        if (flowState === 'waiting_for_answer') {
          stopListening();
          // transcript will update via useEffect
        }
      }}
    />
  );
}
