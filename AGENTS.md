# Haven Matrix — AGENTS.md

AI coding agent rules. Read before touching any file.

## Rule 1 — Every NIM call needs a regex fallback

`nim_compiler.py` has three NIM call types: triage, briefing, handoff script.
- `compile_needs()` → try NIM_ENDPOINT → try NIM_FALLBACK → `_regex_fallback()`
- `generate_briefing()` → try NIM_ENDPOINT → try NIM_FALLBACK → return placeholder string
- `generate_handoff_script()` → try NIM_ENDPOINT → try NIM_FALLBACK → return placeholder string

Never remove `_regex_fallback` or any try/except wrapper around NIM calls.

## Rule 2 — Every cuDF/cuML call needs a pandas/sklearn fallback

`data_ingestion.py` and `solver.py` use the `EngineMode` enum to switch between GPU and CPU paths.
- GPU path: `import cudf as pd_engine`, `from cuml.neighbors import NearestNeighbors`
- CPU path: `import pandas as pd_engine`, `from sklearn.neighbors import NearestNeighbors`
- Imports are inside functions — never at module level — so the module can be imported on a MacBook without cuDF installed

After changing `solver.py` or `data_ingestion.py`, run:
```bash
python backend/solver.py --benchmark
```

## Rule 3 — All FastAPI request/response types use Pydantic models

No `dict` return types without a corresponding Pydantic model in `main.py`. All request bodies are Pydantic `BaseModel` subclasses. FastAPI auto-validates; never bypass with `response_model=None`.

## Rule 4 — Credentials load from .env via config.py — never hardcode

- `NGC_API_KEY` comes from environment
- `NIM_ENDPOINT` and `NIM_FALLBACK` are constants in `config.py`, overridable via env
- No API key, password, or secret ever appears in source code

## Rule 5 — CKAN shelter columns stay UPPERCASE

The Toronto CKAN dataset uses `ORGANIZATION_NAME`, `SHELTER_ADDRESS`, `SECTOR`, `SERVICE_USER_COUNT`, `CAPACITY_ACTUAL_BED`, `UNOCCUPIED_BEDS`, `LAT`, `LON`. Do NOT rename these in `data_ingestion.py` — the masking logic in `solver.py` references them by UPPERCASE name.

## Rule 6 — Kiosk (Gateway B) is voice-only

`KioskPage.tsx` and all its children must never render:
- Text input fields
- Form elements (except the VoiceOrb)
- Visible question text (questions are TTS only)

The tab-navigation audit is: press Tab through `/kiosk` — the only focusable element should be the VoiceOrb. Enforce this before every commit that touches GatewayB components.

## Rule 7 — All user input is PII-scrubbed before LLM inference

`pii_scrubber.redact_pii()` is called inside `voice_session.clean_transcript()` — the single entry point for all text that reaches `compile_needs()`. This covers both kiosk transcripts and caseworker clinical notes.

Patterns redacted: Canadian phone numbers, email addresses, Social Insurance Numbers (SIN), Ontario OHIP health card numbers, postal codes, and numeric dates.

**Never remove or bypass this call.** If you change `clean_transcript()`, verify `redact_pii()` is still called after whitespace normalization and before `return`.

Log audit: the log message is `"PII redacted: N item(s) (type1, type2)"` — it counts what was redacted but never logs the original or redacted text content.

## Rule 8 — Prompt injection attempts on Gateway A are blocked before the LLM

`pii_scrubber.has_injection()` is called in `caseworker_route()` (`main.py`) after `clean_transcript()`. If it returns `True`, the endpoint raises HTTP 400 with a neutral message and logs a warning at `WARNING` level.

- **Only applied to Gateway A** (caseworker text input) — kiosk voice transcripts are low-risk
- The HTTP 400 message must not reveal what triggered the block
- Never log the injected text at INFO or above — `WARNING` message only
