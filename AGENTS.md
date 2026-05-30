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
