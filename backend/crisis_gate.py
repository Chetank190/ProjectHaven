"""
crisis_gate.py
Deterministic crisis detection — plain regex, runs BEFORE any LLM call.
No network dependency. High recall over precision: false positives are
acceptable; false negatives are not.
"""
import re
import logging

logger = logging.getLogger(__name__)

# (regex_pattern, category, hotline)
_CRISIS_PATTERNS: list[tuple[str, str, str]] = [
    (
        r"\b(suicid|kill\s+my\s*self|end\s+my\s+life|want\s+to\s+die|"
        r"don'?t\s+want\s+to\s+live|hurting\s+my\s*self|hurt\s+my\s*self|"
        r"self[- ]harm|self[- ]hurt|no\s+reason\s+to\s+live|"
        r"overdos(?:e|ing)\s+on\s+purpose|trying\s+to\s+kill)\b",
        "mental_health",
        "988",
    ),
    (
        r"\b(overdos(?:e|ing)|not\s+breathing|unconscious|having\s+a\s+seizure|"
        r"chest\s+pain|can'?t\s+breathe|call\s+an?\s+ambulance|dying\s+right\s+now|"
        r"medical\s+emergency|heart\s+attack|stroke)\b",
        "medical",
        "911",
    ),
    (
        r"\b(being\s+attacked|someone\s+has\s+a\s+weapon|in\s+danger\s+right\s+now|"
        r"threatening\s+to\s+kill|knife\s+to\s+my|gun\s+to\s+my|"
        r"emergency\s+right\s+now|stabbed|being\s+stabbed)\b",
        "medical",
        "911",
    ),
]

_ESCALATION_TEXTS: dict[str, str] = {
    "mental_health": (
        "I hear you, and I want you to know help is available right now. "
        "Please call or text 9-8-8 — that's the Suicide and Crisis Lifeline. "
        "They're available 24 hours a day, 7 days a week, and they want to help. "
        "If you're in immediate danger, please also call 9-1-1."
    ),
    "medical": (
        "This sounds like a medical emergency. "
        "Please call 9-1-1 immediately, or ask someone nearby to call for you. "
        "Help is on the way."
    ),
    "general": (
        "If you're in a crisis right now, please call 2-1-1. "
        "They can connect you with emergency services and support 24 hours a day."
    ),
}

_HOTLINE_NAMES: dict[str, str] = {
    "988": "9-8-8 Suicide & Crisis Lifeline",
    "911": "9-1-1 Emergency Services",
    "211": "2-1-1 Community Services",
}


def is_crisis(text: str) -> tuple[bool, str]:
    """
    Scan text for crisis signals. Returns (detected, category).
    Called before any LLM inference — zero network calls.
    """
    t = text.lower()
    for pattern, category, _ in _CRISIS_PATTERNS:
        if re.search(pattern, t):
            logger.warning(f"[crisis_gate] detected category={category}")
            return True, category
    return False, ""


def build_escalation_reply(category: str) -> dict:
    """Structured escalation payload — merged into API response by caller."""
    cat = category if category in _ESCALATION_TEXTS else "general"
    hotline = next(
        (h for _, c, h in _CRISIS_PATTERNS if c == cat),
        "211",
    )
    return {
        "crisis":          True,
        "crisis_category": cat,
        "crisis_hotline":  hotline,
        "hotline_name":    _HOTLINE_NAMES.get(hotline, hotline),
        "escalation_text": _ESCALATION_TEXTS[cat],
    }
