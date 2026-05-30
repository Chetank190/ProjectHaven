"""
guardrails_client.py
NeMo Guardrails integration for Haven Matrix.

Architecture:
  User input → check_input() → (allowed, reason)
    allowed=True  → proceed to compile_needs()
    allowed=False → raise HTTP 400 (caller's responsibility)

Design:
  - PassthroughLLM is injected as the NeMo backend so inputs that PASS all
    rails return "__PASS__" instantly — zero LLM network calls on the hot path.
  - Blocked inputs (jailbreak, harmful) return the hardcoded colang bot message
    immediately — also zero LLM calls.
  - If nemoguardrails is not installed or NIM is offline, check_input() returns
    (True, "unavailable") so the rest of the pipeline is never blocked.

Enable: GUARDRAILS_ENABLED=1
"""

import logging
import os
from pathlib import Path
from typing import Any, List, Optional

logger = logging.getLogger(__name__)

_rails = None
_initialized = False

GUARDRAILS_DIR = Path(__file__).parent.parent / "guardrails"

# Bot messages defined in rails.co — if NeMo returns one of these, input is blocked
_REFUSAL_SIGNALS = (
    "here to help you find social services",
    "can only help you find social services",
    "call 211",
    "visit your nearest shelter",
)


def _make_passthrough_llm():
    """
    A LangChain-compatible LLM that returns '__PASS__' for any prompt.
    Injected into NeMo Guardrails so inputs that clear all rails return
    immediately without a real network call to Gemma NIM.
    """
    try:
        try:
            from langchain_core.language_models.llms import LLM as _BaseLLM
        except ImportError:
            from langchain.llms.base import LLM as _BaseLLM  # type: ignore

        class _PassthroughLLM(_BaseLLM):
            @property
            def _llm_type(self) -> str:
                return "haven_passthrough"

            def _call(self, prompt: str,
                      stop: Optional[List[str]] = None,
                      **kwargs: Any) -> str:
                return "__PASS__"

            async def _acall(self, prompt: str,
                             stop: Optional[List[str]] = None,
                             **kwargs: Any) -> str:
                return "__PASS__"

        return _PassthroughLLM()
    except Exception as exc:
        logger.debug(f"[guardrails] PassthroughLLM unavailable: {exc}")
        return None


def init_guardrails() -> bool:
    """
    Load NeMo Guardrails from guardrails/config.yml + rails.co.
    Returns True if active, False if disabled or unavailable.
    Safe to call multiple times — only initialises once.
    """
    global _rails, _initialized
    if _initialized:
        return _rails is not None
    _initialized = True

    if os.environ.get("GUARDRAILS_ENABLED", "0").lower() not in ("1", "true", "yes"):
        logger.info("[guardrails] disabled — set GUARDRAILS_ENABLED=1 to enable")
        return False

    try:
        from nemoguardrails import RailsConfig, LLMRails
    except ImportError:
        logger.info("[guardrails] nemoguardrails not installed — disabled")
        return False

    if not GUARDRAILS_DIR.exists():
        logger.warning(f"[guardrails] config dir not found at {GUARDRAILS_DIR} — disabled")
        return False

    try:
        # Forward NIM credentials so config.yml env-var interpolation works
        os.environ.setdefault("NIM_ENDPOINT", "http://localhost:8001/v1")
        os.environ.setdefault("NIM_API_KEY", "not-needed")

        config = RailsConfig.from_path(str(GUARDRAILS_DIR))
        passthrough = _make_passthrough_llm()
        _rails = LLMRails(config=config, llm=passthrough, verbose=False)
        logger.info("[guardrails] NeMo Guardrails active (PassthroughLLM — zero inference overhead)")
        return True
    except Exception as exc:
        logger.warning(f"[guardrails] init failed: {exc} — disabled")
        _rails = None
        return False


async def check_input(text: str) -> tuple[bool, str]:
    """
    Run NeMo Guardrails input check.

    Returns:
        (True,  "ok")          — safe to proceed with compile_needs()
        (True,  "unavailable") — guardrails not running; proceed anyway
        (False, "blocked")     — blocked by a rail; caller should return HTTP 400

    Never raises — falls back to (True, "unavailable") on any error.
    """
    if _rails is None:
        return True, "unavailable"

    try:
        response = await _rails.generate_async(
            messages=[{"role": "user", "content": text}]
        )
        resp_str = (response or "").lower()

        # PassthroughLLM returns "__PASS__" when no blocking rail matched
        if "__pass__" in resp_str:
            return True, "ok"

        # Colang bot messages signal a blocked input
        if any(sig in resp_str for sig in _REFUSAL_SIGNALS):
            logger.warning(f"[guardrails] input blocked: {resp_str[:80]!r}")
            return False, "blocked"

        # Unknown response — allow through (fail-open)
        return True, "ok"

    except Exception as exc:
        logger.warning(f"[guardrails] check error: {exc} — allowing through")
        return True, "error_fallback"
