"""
voice_session.py
Audio session management: transcript cleaning, eligibility question logic,
session state tracking, and timeout enforcement.
All voice timing constants come from config.py — tune without touching this file.
"""

import re
import time
import uuid
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from config import (
    VOICE_SESSION_IDLE_SEC,
    VOICE_MIN_TRANSCRIPT_CHARS,
    ASK_ID_FOR_PILLARS,
    ASK_SOBRIETY_FOR_PILLARS,
    ASK_GROUP_FOR_PILLARS,
)
from nim_compiler import NeedsPayload


@dataclass
class VoiceSession:
    session_id:          str   = field(default_factory=lambda: str(uuid.uuid4())[:8])
    created_at:          float = field(default_factory=time.time)
    payload_draft:       NeedsPayload | None = None
    eligibility_answers: dict  = field(default_factory=dict)
    questions_asked:     list  = field(default_factory=list)
    origin:              tuple | None = None


# In-memory session store — expires after VOICE_SESSION_IDLE_SEC
_sessions: dict[str, VoiceSession] = {}


def create_session(payload: NeedsPayload, origin: tuple) -> VoiceSession:
    s = VoiceSession(payload_draft=payload, origin=origin)
    _sessions[s.session_id] = s
    return s


def get_session(session_id: str) -> VoiceSession | None:
    _cleanup_expired()
    return _sessions.get(session_id)


def resolve_eligibility_questions(payload: NeedsPayload) -> list[str]:
    """
    Determine which eligibility questions to ask based on active pillars.
    Returns ordered list of TTS-ready question strings (max 3).
    Questions only asked if the answer is not already known from the transcript.
    """
    questions = []
    active = [
        p for p in ["shelter", "rehab", "food", "hygiene", "supplies"]
        if getattr(payload, f"needs_{p}", False)
    ]

    if any(p in ASK_ID_FOR_PILLARS for p in active) and payload.has_id is None:
        questions.append(
            "Do you have a piece of ID with you right now? Just say yes or no."
        )

    if any(p in ASK_SOBRIETY_FOR_PILLARS for p in active) and payload.sobriety_status is None:
        questions.append(
            "Have you had anything to drink or used anything in the last few hours? "
            "No judgement — just say yes or no."
        )

    if any(p in ASK_GROUP_FOR_PILLARS for p in active) and payload.group_size is None:
        questions.append(
            "Are you on your own, or do you have family or children with you?"
        )

    return questions[:3]


def parse_eligibility_answer(question_text: str, answer_transcript: str) -> dict:
    """
    Parse a single eligibility answer using keyword matching — not the NIM.
    Returns a dict with the relevant field update (e.g. {"has_id": False}).
    """
    t = answer_transcript.lower().strip()
    q = question_text.lower()

    if "id" in q:
        if any(w in t for w in ["yes", "yeah", "yep", "have it", "got it", "i do"]):
            return {"has_id": True}
        if any(w in t for w in ["no", "nope", "don't have", "lost", "don't", "haven't"]):
            return {"has_id": False}
        return {"has_id": None}

    if "drink" in q or "used" in q:
        if any(w in t for w in ["yes", "yeah", "yep", "have been", "little bit", "bit", "little"]):
            return {"sobriety_status": "using"}
        if any(w in t for w in ["no", "nope", "sober", "clean", "haven't", "not"]):
            return {"sobriety_status": "sober"}
        return {"sobriety_status": None}

    if "family" in q or "children" in q:
        if any(w in t for w in ["family", "kids", "children", "baby", "wife", "husband",
                                  "partner", "with someone", "not alone"]):
            return {"group_size": "with_family"}
        if any(w in t for w in ["alone", "myself", "just me", "on my own", "solo", "by myself"]):
            return {"group_size": "alone"}
        return {"group_size": None}

    return {}


def clean_transcript(raw: str) -> str:
    """
    Remove filler words and normalize punctuation.
    Raises ValueError if transcript is too short to process.
    """
    if not raw or len(raw.strip()) < VOICE_MIN_TRANSCRIPT_CHARS:
        raise ValueError(
            f"Transcript too short (min {VOICE_MIN_TRANSCRIPT_CHARS} chars). "
            "Please speak again."
        )

    fillers = ["um", "uh", "like", "you know", "i mean", "kind of", "sort of", "basically"]
    cleaned = raw.strip()
    for f in fillers:
        cleaned = cleaned.replace(f" {f} ", " ")

    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def build_tts_itinerary_script(itinerary: dict, client_name: str | None = None) -> str:
    """
    Convert itinerary dict into a natural, TTS-friendly spoken script.
    Short sentences. No jargon. Spoken walking directions.
    """
    lines = []
    greeting = (
        f"Here's what I found for {client_name}."
        if client_name
        else "Here's what I found for you."
    )
    lines.append(greeting)

    stops = [(pillar, results[0]) for pillar, results in itinerary.items() if results]

    if not stops:
        return (
            "I'm sorry, I couldn't find available resources nearby right now. "
            "Please call 211 for help."
        )

    for i, (pillar, r) in enumerate(stops, 1):
        walk = int(r.get("distance_walk_min", 0))
        transit = "There's a TTC stop nearby." if r.get("transit_accessible") else ""

        line = f"Stop {i}: {r.get('name', 'Unknown facility')}, for {pillar}. "
        line += f"About a {walk} minute walk, at {r.get('address', 'address unavailable')}. {transit}"

        if r.get("intake_preparation"):
            line += f" When you arrive: {r['intake_preparation']}"

        lines.append(line.strip())

    lines.append("Good luck. You can ask me again any time.")
    return " ".join(lines)


def _cleanup_expired():
    """Remove sessions older than VOICE_SESSION_IDLE_SEC."""
    now = time.time()
    expired = [
        sid for sid, s in _sessions.items()
        if now - s.created_at > VOICE_SESSION_IDLE_SEC
    ]
    for sid in expired:
        del _sessions[sid]
