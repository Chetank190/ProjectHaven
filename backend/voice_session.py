"""
voice_session.py
Audio session management: transcript cleaning, eligibility question logic,
session state tracking, and timeout enforcement.
All voice timing constants come from config.py — tune without touching this file.
"""

import logging
import re
import time
import uuid
import sys
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

sys.path.insert(0, str(Path(__file__).parent))

from config import (
    VOICE_SESSION_IDLE_SEC,
    VOICE_MIN_TRANSCRIPT_CHARS,
    ASK_GENDER_FOR_PILLARS,
    ASK_AGE_FOR_PILLARS,
    ASK_ID_FOR_PILLARS,
    ASK_SOBRIETY_FOR_PILLARS,
    ASK_GROUP_FOR_PILLARS,
)
from nim_compiler import NeedsPayload
from pii_scrubber import redact_pii


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
    needs = [k.replace("needs_", "") for k, v in payload.model_dump().items()
             if k.startswith("needs_") and v]
    logger.info(
        f"[session:{s.session_id}] created  needs={needs}  "
        f"sector={payload.sector}  origin={origin}"
    )
    return s


def get_session(session_id: str) -> VoiceSession | None:
    _cleanup_expired()
    s = _sessions.get(session_id)
    if s is None:
        logger.debug(f"[session:{session_id}] lookup miss (expired or unknown)")
    return s


def resolve_eligibility_questions(payload: NeedsPayload) -> list[str]:
    """
    Determine which eligibility questions to ask based on active pillars.
    Returns ordered list of TTS-ready question strings (max 3).
    Questions only asked if the answer is not already known from the transcript.
    Priority: age → gender → ID → sobriety → group — most impactful filters first.
    """
    questions = []
    active = [
        p for p in ["shelter", "rehab", "food", "hygiene", "supplies"]
        if getattr(payload, f"needs_{p}", False)
    ]

    # Age — determines youth vs adult shelter pool (asked first; biggest pool filter)
    if any(p in ASK_AGE_FOR_PILLARS for p in active) and payload.sector == "any":
        questions.append(
            "Are you 24 years old or younger? "
            "We have shelters specifically for young people if so."
        )

    # Gender — many Toronto shelters are gender-specific (men's, women's, co-ed)
    if any(p in ASK_GENDER_FOR_PILLARS for p in active) and payload.gender is None:
        questions.append(
            "To find the right shelter for you — are you looking for a men's shelter, "
            "a women's shelter, or would any available bed work?"
        )

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

    selected = questions[:3]
    # Log which questions were skipped (already known from transcript) vs selected
    skipped = [k for k, already_known in [
        ("age",      payload.sector != "any"),
        ("gender",   payload.gender is not None),
        ("id",       payload.has_id is not None),
        ("sobriety", payload.sobriety_status is not None),
        ("group",    payload.group_size is not None),
    ] if already_known]
    logger.info(
        f"[eligibility] questions={len(selected)}  "
        f"types={[_q_type(q) for q in selected]}  "
        f"already_known={skipped or 'none'}"
    )
    return selected


def _q_type(q: str) -> str:
    ql = q.lower()
    if "24" in ql or "younger" in ql: return "age"
    if "men's" in ql or "women's" in ql: return "gender"
    if " id " in ql or ql.endswith("id?"): return "id"
    if "drink" in ql or "used" in ql: return "sobriety"
    if "family" in ql or "children" in ql: return "group"
    return "unknown"


def parse_eligibility_answer(question_text: str, answer_transcript: str) -> dict:
    """
    Parse a single eligibility answer using keyword matching — not the NIM.
    Returns a dict with the relevant field update (e.g. {"has_id": False}).
    """
    t = answer_transcript.lower().strip()
    q = question_text.lower()

    # Age question → sets sector (youth vs adult)
    if "24" in q or "younger" in q:
        if any(w in t for w in ["yes", "yeah", "yep", "under", "young", "teenager", "teen", "i am"]):
            return {"sector": "youth"}
        if any(w in t for w in ["no", "nope", "older", "over", "adult", "not young", "i'm not"]):
            return {"sector": "adult"}
        return {}

    # Gender question
    if "men's shelter" in q or "women's shelter" in q or "any available bed" in q:
        if any(w in t for w in ["women", "woman", "female", "ladies", "lady", "girl"]):
            return {"gender": "female"}
        if any(w in t for w in ["men", "man", "male", "guys", "guy"]):
            return {"gender": "male"}
        if any(w in t for w in ["any", "either", "doesn't matter", "don't mind", "both",
                                  "non-binary", "nonbinary", "trans", "whatever"]):
            return {"gender": None}
        return {}

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

    # Redact Canadian PII patterns before any LLM inference
    cleaned, pii_count, pii_types = redact_pii(cleaned)
    if pii_count > 0:
        logger.info(f"[pii] redacted {pii_count} item(s): {', '.join(pii_types)}")

    return cleaned


def build_tts_itinerary_script(itinerary: dict, client_name: str | None = None) -> str:
    """
    Convert itinerary dict into a natural, TTS-friendly spoken script.
    Short sentences. No jargon. Spoken walking directions.
    """
    lines = []
    greeting = (
        f"I found some places that can help {client_name} today."
        if client_name
        else "I found some places that can help you today."
    )
    lines.append(greeting)

    stops = [(pillar, results[0]) for pillar, results in itinerary.items() if results]

    if not stops:
        return (
            "I'm sorry, I couldn't find open resources nearby right now. "
            "Please call two-one-one for help."
        )

    order_words = {1: "First", 2: "Next", 3: "Also", 4: "Also", 5: "Also"}
    for i, (pillar, r) in enumerate(stops, 1):
        walk = int(r.get("distance_walk_min", 0))
        transit = "There's a TTC stop nearby." if r.get("transit_accessible") else ""
        lead = order_words.get(i, "Also")

        line = f"{lead}, go to {r.get('name', 'a facility nearby')}, for {pillar}. "
        line += f"It's about a {walk} minute walk, at {r.get('address', 'the address shown on screen')}. {transit}"

        if r.get("intake_preparation"):
            line += f" When you get there: {r['intake_preparation']}"

        lines.append(line.strip())

    lines.append("I hope this helps. Come back any time you need.")
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
    if expired:
        logger.debug(f"[session_gc] expired {len(expired)} session(s) — active={len(_sessions)}")
