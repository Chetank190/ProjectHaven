"""
pii_scrubber.py
PII redaction and prompt injection detection for Haven Matrix.

Two public functions:
  redact_pii(text)   — replace Canadian PII patterns with [REDACTED]
  has_injection(text) — detect prompt injection attempts on Gateway A

Called by voice_session.clean_transcript() before any LLM inference.
"""

import re
import logging

logger = logging.getLogger(__name__)

# ── PII patterns (Canadian / Toronto context) ─────────────────────────────────
# Order matters: more specific patterns first to avoid partial matches.
_PII_PATTERNS: list[tuple[str, str, int]] = [
    # Ontario OHIP health card: 4-3-3 digits, optional 2-letter version code
    ("health_card",  r'\b\d{4}[-\s]?\d{3}[-\s]?\d{3}[-\s]?[A-Za-z]{0,2}\b',  0),
    # Canadian Social Insurance Number: 3-3-3 digits
    ("sin",          r'\b\d{3}[-\s]\d{3}[-\s]\d{3}\b',                          0),
    # North American phone number (various formats)
    ("phone",        r'\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b', 0),
    # Email address
    ("email",        r'\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b', 0),
    # Canadian postal code (A1A 1A1)
    ("postal_code",  r'\b[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d\b',                0),
    # Numeric dates: DD/MM/YYYY, MM-DD-YYYY, YYYY-MM-DD
    ("date",         r'\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b', 0),
]

# ── Prompt injection patterns ─────────────────────────────────────────────────
# Patterns must be specific enough not to fire on legitimate caseworker language.
# False-positive risk: "Ignore prior clinical notes", "Disregard the previous flag",
# "User: male, 34" — all normal intake phrasing that broad patterns would block.
_INJECTION_PATTERNS: list[tuple[str, int]] = [
    # "ignore all/your/every [previous] instructions" — ownership/totality modifier required.
    # Does NOT fire on: "ignore prior clinical instructions", "disregard previous medical directives"
    # because those lack the explicit all/your/every/these ownership token.
    (r'\b(?:ignore|disregard)\s+(?:all(?:\s+your)?\s+|your\s+|every\s+|these\s+)(?:previous\s+|prior\s+|above\s+)?(?:instructions?|prompts?|rules?|directives?|context)\b', re.IGNORECASE),
    # "ignore the above/previous/original instructions" — "the" + specific temporal token,
    # no intervening clinical adjective allowed (stops before reaching the noun immediately).
    (r'\b(?:ignore|disregard)\s+the\s+(?:above|previous|prior|original)\s+(?:instructions?|prompts?|rules?|directives?|context|prompt)\b', re.IGNORECASE),
    (r'forget\s+(everything|all|your\s+instructions)',                                  re.IGNORECASE),
    (r'you\s+are\s+now\s+(a|an)\s+\w+',                                                re.IGNORECASE),
    # LLM chat-format role tokens — "system:" and "assistant:" never appear in real intake notes;
    # "user:" is excluded because caseworkers legitimately label demographics that way.
    (r'\b(system|assistant)\s*:\s',                                                     re.IGNORECASE),
    # Special tokens used to escape prompt context in model inputs
    (r'<\|?\s*(system|endoftext|im_start|im_end)\s*\|?>',                              re.IGNORECASE),
    (r'\b(jailbreak|dan\s+mode|do\s+anything\s+now)\b',                                re.IGNORECASE),
]


def redact_pii(text: str) -> tuple[str, int, list[str]]:
    """
    Replace Canadian PII patterns with [REDACTED].
    Returns (redacted_text, total_matches, list_of_pattern_names_matched).
    Safe to call on any string — never raises.
    """
    total = 0
    types_found: list[str] = []
    for name, pattern, flags in _PII_PATTERNS:
        try:
            new_text, n = re.subn(pattern, "[REDACTED]", text, flags=flags)
            if n > 0:
                text = new_text
                total += n
                types_found.append(name)
        except Exception as exc:
            logger.debug(f"[pii_scrubber] pattern '{name}' error: {exc}")
    return text, total, types_found


def has_injection(text: str) -> bool:
    """
    Return True if text contains a recognisable prompt injection attempt.
    Used only on Gateway A (caseworker notes) — not on kiosk voice transcripts.
    """
    for pattern, flags in _INJECTION_PATTERNS:
        try:
            if re.search(pattern, text, flags):
                return True
        except Exception as exc:
            logger.debug(f"[pii_scrubber] injection pattern error: {exc}")
    return False
