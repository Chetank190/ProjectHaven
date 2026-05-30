# Haven Matrix — Implementation Reference & LLM Handoff

> **Last updated:** 2026-05-30 (Session 5 — NeMo Guardrails + ASR NIM + PII + Voice UX)
> **Last commit:** `c437d2a` + all sessions below
> **Status:** Fully functional in CPU/regex mode (local dev). Cloud NIM active when NGC_API_KEY set. GPU path requires RAPIDS container on GX10. ASR NIM optional (port 9000). NeMo Guardrails optional (GUARDRAILS_ENABLED=1).

This document is the authoritative source for continuing work on Haven Matrix. It covers the full current state of every module, recent changes, known remaining issues, and how to extend the system.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Backend Module Reference](#2-backend-module-reference)
3. [Frontend Module Reference](#3-frontend-module-reference)
4. [Data Files](#4-data-files)
5. [Complete Data Flows](#5-complete-data-flows)
6. [Agent Rules (Hard Constraints)](#6-agent-rules-hard-constraints)
7. [Recent Changes Log](#7-recent-changes-log)
8. [Known Remaining Issues](#8-known-remaining-issues)
9. [Extension Guide](#9-extension-guide)
10. [Testing Checklist](#10-testing-checklist)
11. [GX10 Remote Access & GPU Model Setup](#11-gx10-remote-access--gpu-model-setup)

---

## 1. System Overview

### Architecture

```
+-------------------------------------------------------------+
|                    PRESENTATION LAYER                        |
|  Gateway A (Caseworker)    |  Gateway B (Kiosk - voice only)|
|  React :3000/caseworker    |  React :3000/kiosk             |
+-------------------------------------------------------------+
                         | HTTP POST (Vite proxy /api -> :8000)
+-------------------------------------------------------------+
|              FastAPI BACKEND  (port 8000)                    |
|  POST /api/v1/caseworker/route                              |
|  POST /api/v1/kiosk/session + /kiosk/route                  |
|  POST /api/v1/transcribe  (audio → ASR NIM)                 |
|  POST /api/v1/caseworker/briefing                           |
|  POST /api/v1/handoff-script                                |
|  GET  /api/v1/benchmark  |  GET /api/v1/health              |
+-------------------------------------------------------------+
          |                            |
+---------------------+   +--------------------------+
|  SAFETY LAYER       |   |  ASR INFERENCE (port 9000)|
|  pii_scrubber.py    |   |  Parakeet-0.6B-CTC NIM   |
|  NeMo Guardrails    |   |  (optional; Web Speech    |
|  (GUARDRAILS_       |   |   API fallback in browser)|
|   ENABLED=1)        |   +--------------------------+
+---------------------+
          |
+-------------------------------------------------------------+
|     LLM INFERENCE (4-tier chain)                            |
|     cloud NIM → llama.cpp :30000 → NIM container :8001      |
|     Fallback: regex keyword extractor (always available)    |
+-------------------------------------------------------------+
                         |
+-------------------------------------------------------------+
|     GPU DATA (RAPIDS - 128 GB unified memory on GX10)       |
|     cuDF: 7 datasets (shelters, rehab, food, hygiene,       |
|           grassroots, OSM, TTC stops)                       |
|     cuML: NearestNeighbors KNN (haversine, < 10ms GPU)      |
|     CPU fallback: pandas + scikit-learn (~400ms)            |
+-------------------------------------------------------------+
```

### Tech Stack

| Layer | Tech | Why |
|-------|------|-----|
| LLM | Nemotron-30B via llama.cpp | Fits in 128 GB unified memory; deterministic JSON output |
| LLM fallback | Gemma 3n E4B via NIM container (:8001) | NVFP4 on Blackwell; same OpenAI API |
| ASR | Parakeet-0.6B-CTC via NIM (:9000) | NVIDIA speech recognition; ~3 GB; Web Speech API fallback |
| Guardrails | NeMo Guardrails + `pii_scrubber.py` | Pattern-matching rails (jailbreak, harmful); Canadian PII redaction |
| Backend | FastAPI + uvicorn | Async; Pydantic validation; auto Swagger at /docs |
| GPU compute | cuDF + cuML (RAPIDS) | Zero-copy data; KNN in < 10ms vs ~400ms pandas |
| CPU fallback | pandas + scikit-learn | Identical API; automatically used on MacBook dev |
| Frontend | React + Vite + TypeScript | Fast; dual-recording (MediaRecorder + Web Speech) |
| Voice input | MediaRecorder → Parakeet ASR NIM | GPU ASR; falls back to Web Speech API if NIM offline |
| Voice output | speechSynthesis (browser) | pitch=0.85, preferred voice (Google UK English Female) |
| Deployment | Docker Compose (GX10) | nvidia runtime; nim + asr services |

---

## 2. Backend Module Reference

### `backend/config.py` — All Constants

No logic. Tune everything here. Other modules import from here.

**File paths:**
```python
DATA_DIR       = Path("data")
SHELTERS_CSV   = DATA_DIR / "shelters.csv"
REHAB_CSV      = DATA_DIR / "rehab_services.csv"
FOOD_CSV       = DATA_DIR / "food_banks.csv"
HYGIENE_CSV    = DATA_DIR / "hygiene_stations.csv"
GRASSROOTS_CSV = DATA_DIR / "grassroots_services.csv"
OSM_JSON       = DATA_DIR / "osm_amenities.json"
GTFS_STOPS_TXT = DATA_DIR / "stops.txt"
```

**LLM endpoints (override via env vars):**
```python
NIM_ENDPOINT    = os.environ.get("NIM_ENDPOINT", "http://localhost:30000/v1")   # llama.cpp
NIM_FALLBACK    = os.environ.get("NIM_FALLBACK", "http://localhost:8001/v1")    # NIM container
NIM_MODEL       = "nemotron"
NIM_TIMEOUT_SEC = 15
NIM_MAX_RETRIES = 2

# Skip cuDF/cuML when true — reserve GPU for LLM (Gemma NIM / llama.cpp)
FORCE_CPU_SOLVER = os.environ.get("FORCE_CPU_SOLVER", "0").lower() in ("1", "true", "yes")
```

**Solver weights (FR-5 Congestion Balancer):**
```python
WEIGHT_DISTANCE  = 0.60   # normalized km distance (lower = closer = better)
WEIGHT_OCCUPANCY = 0.30   # occupancy_ratio 0.0-1.0 (lower = more available = better)
WEIGHT_TRANSIT   = 0.10   # 0.0 if transit nearby, 1.0 if not
TRANSIT_RADIUS_M = 200    # metres to nearest TTC stop
KNN_RESULTS_PER_PILLAR = 3
```

**Voice/session timeouts:**
```python
VOICE_HOLD_MAX_SEC         = 45
VOICE_SILENCE_KILL_SEC     = 10
VOICE_SESSION_IDLE_SEC     = 120
VOICE_ELIGIBILITY_WAIT_SEC = 30
VOICE_MIN_TRANSCRIPT_CHARS = 10
```

**Eligibility question triggers:**
```python
ASK_ID_FOR_PILLARS       = ["shelter", "rehab"]
ASK_SOBRIETY_FOR_PILLARS = ["shelter"]
ASK_GROUP_FOR_PILLARS    = ["shelter"]
```

**Kiosk hub coordinates (pre-set locations for Gateway B):**
```python
KIOSK_HUBS = {
    "Union Station":      (43.6452, -79.3806),
    "Yonge & Dundas":     (43.6561, -79.3802),
    "Scarborough Centre": (43.7731, -79.2573),
    "Regent Park":        (43.6583, -79.3601),
    "Etobicoke Civic":    (43.6435, -79.5665),
}
KIOSK_DEFAULT_HUB = os.environ.get("VITE_KIOSK_HUB", "Union Station")
```

**ASR NIM constants (new):**
```python
ASR_NIM_URL     = os.environ.get("ASR_NIM_URL",   "http://localhost:9000")
ASR_CLOUD_URL   = os.environ.get("ASR_CLOUD_URL", "https://integrate.api.nvidia.com/v1")
ASR_NIM_TIMEOUT = 30
```

**System prompts:** `NIM_TRIAGE_PROMPT` (strict JSON schema + PRIVACY RULE block), `NIM_BRIEFING_PROMPT` (3-5 sentences), `NIM_HANDOFF_PROMPT` (4-6 sentence phone script)

**`NIM_TRIAGE_PROMPT` privacy rule (added):** Opens with a block instructing the model to ignore personal identifiers (names, addresses, health conditions) even after PII scrubbing — defence in depth.

---

### `backend/data_ingestion.py` — Dataset Loader

**Main entry:** `load_all(mode: EngineMode) -> (dict, float)`

Returns `(datasets_dict, elapsed_ms)`. Called twice at startup: GPU first, CPU second for benchmark.

**Dataset keys:** `shelters`, `rehab`, `food`, `hygiene`, `grassroots`, `osm`, `stops`

**Load flow:**
1. Attempt live CKAN fetch for shelters -> cache locally if coordinates present
2. Fall back to local `shelters.csv` if CKAN unavailable or missing coordinates
3. Load all other CSVs directly
4. Load OSM JSON (wrapped in try-except -> empty DataFrame on failure)
5. Load GTFS stops (stop_id, stop_name, lat, lon only)
6. Standardize all lat/lon column names and cast to float32

**Defensive column additions (all non-shelter datasets):**
```python
requires_id       -> default False
harm_reduction    -> default True
bypass_pathway    -> default ""
intake_preparation -> default ""
occupancy_ratio   -> default 0.5
```

**Column naming convention (IMPORTANT — Agent Rule 5):**
- Shelters: UPPERCASE (ORGANIZATION_NAME, SHELTER_ADDRESS, SECTOR, LAT, LON, CAPACITY_ACTUAL_BED, UNOCCUPIED_BEDS, SERVICE_USER_COUNT)
- All other datasets: lowercase (organization_name, address, lat, lon)
- Do NOT rename shelter columns — CKAN returns them uppercase

**Key helpers:**
- `_fetch_shelters_ckan(pd_engine)` -> DataFrame or None
- `_load_osm(pd_engine)` -> DataFrame (flattens OSM tags; try-except wrapping)
- `_standardize_coords(df, lat_col, lon_col)` -> DataFrame (renames variants, casts float32)

---

### `backend/nim_compiler.py` — LLM Client

**NeedsPayload (Pydantic model):**
```python
needs_shelter:   bool
needs_rehab:     bool
needs_food:      bool
needs_supplies:  bool
needs_hygiene:   bool
sector:          str   = "any"    # validated: youth|adult|family|any
has_id:          bool | None = None
sobriety_status: str  | None = None  # validated: sober|using|None
group_size:      str  | None = None  # validated: alone|with_family|None
```

**4-tier retry chain for `compile_needs(text)`:**
```
Tier 1: NVIDIA cloud NIM   https://integrate.api.nvidia.com/v1
         Model: google/gemma-3n-e4b-it  Auth: NGC_API_KEY
         (skipped if NGC_API_KEY not set)
  ->
Tier 2: local llama.cpp    http://localhost:30000/v1
         Model: nemotron   Auth: NIM_API_KEY (default "not-needed")
  ->
Tier 3: local NIM container http://localhost:8001/v1
         Model: google/gemma-3n-e4b-it  Auth: NIM_API_KEY
  ->
Tier 4: _regex_fallback(text) -- pure keywords, no network, always works
Returns: (NeedsPayload, method="nim"|"regex", latency_ms)
```

**`_nim_tiers()`** — builds the tier list at call time from env vars. Cloud tier only included if `NGC_API_KEY` is set. `generate_briefing` and `generate_handoff_script` use the same tier list.

**`_call_nim(text, endpoint, system_prompt, model=None, api_key="not-needed")`:**
- OpenAI-compatible client; model and api_key per-tier
- Strips markdown fences before JSON parse
- temperature=0.0 for triage (deterministic), 0.3-0.4 for briefing/handoff

**About Gemma 3n E4B (NVFP4):**
- Google's Gemma 3 "nano" Effective 4B model — 4B active parameters per step
- NVFP4 = NVIDIA's 4-bit float, runs natively on Blackwell (GX10)
- Faster than Nemotron-30B, smaller footprint — leaves more of 128 GB for cuDF/cuML
- Strong structured JSON output — ideal for the 9-field triage schema
- NIM Docker image: `nvcr.io/nim/google/gemma-3n-e4b-it:latest`

**`_regex_fallback(text)`:** Pure keyword matching, no network dependency. Always returns valid NeedsPayload.

**`generate_briefing(shelter_summary)`** and **`generate_handoff_script(facility_name, payload)`:**
Both try NIM_ENDPOINT -> NIM_FALLBACK -> static placeholder text.

---

### `backend/solver.py` — Constraint-Aware KNN

**Main entry:** `solve(payload, datasets, origin, mode) -> (itinerary_dict, elapsed_ms)`

**Algorithm:**
1. `_apply_masks(payload, datasets, pd_engine)` -> filtered dataset dict
2. For each pillar: run KNN (k = min(9, dataset_size), haversine metric, brute force)
3. `_score_and_rank(df, indices, distances_km, stops_df, pillar_name)` -> sorted results
4. Return top `KNN_RESULTS_PER_PILLAR` (3) per pillar

**Scoring formula:**
```
composite_score = (0.60 x dist_norm) + (0.30 x occupancy_ratio) + (0.10 x transit_binary)
```
- `dist_norm` = distance_km / max_distance_in_candidates (0.0-1.0)
- `occupancy_ratio` = SERVICE_USER_COUNT / CAPACITY (shelters); 0.5 default (others)
- `transit_binary` = 0.0 if TTC stop within 200m, 1.0 if not
- **Lower score = better** (sorted ascending)

**Eligibility masking (`elig(df)`):**
```python
m_id  = (df["requires_id"] == False) if (has_id is False and col exists) else True
m_sob = (df["harm_reduction"] == True) if (sobriety_status=="using" and col exists) else True
return m_id & m_sob
```
Note: `has_id=None` passes all facilities through (optimistic — known remaining issue).

**Shelter-specific masking:**
- Filters `UNOCCUPIED_BEDS > 0`
- Filters by sector: youth/adult/family/any (via sector_map)
- Filters by `group_size == "with_family"` -> Families sector only

**Pillar dataset merging:**
- `food`: food_banks + grassroots concatenated
- `hygiene`: hygiene_stations + osm concatenated

**Transit check (`_check_transit`):**
- Bounding-box: `lat_deg = 200/111_000`, `lon_deg = 200/80_000` (Toronto ~80 km/degree lon)
- Returns True if any GTFS stop within box; silent False on exception

**Result dict per facility:**
```
pillar, name, address, lat, lon, distance_km, distance_walk_min,
occupancy_ratio, transit_accessible, composite_score,
phone, hours, requires_id, harm_reduction,
bypass_pathway, intake_preparation, accessible
```

---

### `backend/voice_session.py` — Session & Voice Logic

**VoiceSession dataclass:**
```python
session_id:          str   (UUID[:8])
created_at:          float (Unix timestamp)
payload_draft:       NeedsPayload | None
eligibility_answers: dict
questions_asked:     list
origin:              tuple(lat, lon) | None
```

**In-memory store:** `_sessions: dict[str, VoiceSession]` — expires after 120s

**Key functions:**

| Function | Purpose |
|----------|---------|
| `create_session(payload, origin)` | Creates and stores session |
| `get_session(session_id)` | Runs _cleanup_expired(), returns session or None |
| `resolve_eligibility_questions(payload)` | Returns up to 3 TTS-ready question strings |
| `parse_eligibility_answer(question, answer)` | Keyword -> {field: value} — imported but NOT called by main.py; frontend mirrors this logic |
| `clean_transcript(raw)` | Removes fillers, validates >= 10 chars, calls `redact_pii()`, raises ValueError if too short |
| `build_tts_itinerary_script(itinerary, client_name)` | Warm spoken script: "First, go to…", "Next…", "I hope this helps." |
| `_cleanup_expired()` | Removes sessions older than VOICE_SESSION_IDLE_SEC |

---

### `backend/pii_scrubber.py` — PII Redaction + Injection Detection (new)

Two public functions, no external dependencies beyond `re`.

**`redact_pii(text: str) -> tuple[str, int, list[str]]`**

Regex patterns for Canadian PII:

| Pattern | What it catches |
|---------|----------------|
| `phone` | North American phone numbers (various formats) |
| `email` | Email addresses |
| `sin` | Social Insurance Numbers (3-3-3 digit format) |
| `health_card` | Ontario OHIP numbers (4-3-3 format + version code) |
| `postal_code` | Canadian postal codes (A1A 1A1) |
| `date` | Numeric dates (DD/MM/YYYY, YYYY-MM-DD) |

Returns `(redacted_text, count, list_of_types)`. Replaces matches with `[REDACTED]`. Called by `clean_transcript()` before any LLM sees the text.

**`has_injection(text: str) -> bool`**

Detects prompt injection patterns (7 patterns: "ignore previous instructions", "you are now a different AI", jailbreak markers, etc.). Called only on Gateway A (caseworker route) — not kiosk.

---

### `backend/guardrails_client.py` — NeMo Guardrails (new)

**`init_guardrails() -> bool`** — Called at startup in lifespan. Loads `guardrails/config.yml` + `guardrails/rails.co`. Injects a `PassthroughLLM` as the NeMo backend so inputs that pass all rails return `__PASS__` instantly (zero network overhead). Returns False and logs `"disabled"` if `GUARDRAILS_ENABLED` not set or `nemoguardrails` not installed.

**`async check_input(text: str) -> tuple[bool, str]`** — Called on both caseworker and kiosk routes after `clean_transcript()`. Returns `(True, "ok")` for safe inputs, `(False, "blocked")` for rails violations. Never raises — fail-open `(True, "unavailable")` on any error.

**Rail definitions (`guardrails/rails.co`, colang 1.0):**
- `check jailbreak` — blocks "ignore previous instructions", "you are now a different AI", etc.
- `check harmful request` — blocks "how to get drugs illegally", "how to hurt myself", etc.

**Refusal messages** are defined in the colang file and cross-checked in `check_input()` by substring match. Enable via `GUARDRAILS_ENABLED=1`.

---

### `backend/main.py` — FastAPI App

**Global state:**
```python
datasets_gpu: dict  # GPU or CPU-backed (depends on _rapids_mode)
datasets_cpu: dict  # Always CPU-backed
_last_benchmark: dict = {"gpu_ms": None, "cpu_ms": None}
_rapids_mode: str = "cpu"  # "gpu" if RAPIDS loaded
```

**Lifespan hook:** GPU load -> CPU load -> start `_session_gc()` asyncio task (60s interval)

**CORS:** `os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")` — GET+POST, Content-Type only

**Lifespan hook:** GPU load → CPU load → `init_guardrails()` → `fetch_weather_alert()` → start `_session_gc()` + `_hydration_loop()` asyncio tasks.

**Request models with validation:**
```python
CaseworkerRouteRequest: text=Field(..., max_length=5000),
                        origin_lat=Field(43.6532, ge=-90, le=90),
                        origin_lon=Field(-79.3832, ge=-180, le=180),
                        client_name=Field(None, max_length=100)
KioskSessionRequest:    transcript=Field(..., max_length=2000),
                        origin_lat, origin_lon
KioskRouteRequest:      session_id, eligibility_answers: dict
BriefingRequest:        current_time_iso
HandoffRequest:         facility_name, facility_phone, payload: NeedsPayload
```

**Endpoints:**

| Method | Path | What it does |
|--------|------|--------------|
| GET | `/api/v1/health` | Status, rapids_mode, NIM_ENDPOINT, dataset row counts, **nemo_guardrails** status |
| GET | `/api/v1/benchmark` | Last GPU/CPU solve times and speedup ratio |
| GET | `/api/v1/system` | Live GPU utilization via pynvml (GX10) |
| GET | `/api/v1/telemetry/summary` | Shadow Census aggregate stats from daily_telemetry.csv |
| POST | `/api/v1/transcribe` | **NEW** — audio blob → Parakeet ASR NIM → transcript text (3-tier: local→cloud→503) |
| POST | `/api/v1/caseworker/route` | PII scrub → injection check → NeMo Guardrails → NeedsPayload → GPU+CPU solve → itinerary |
| POST | `/api/v1/kiosk/session` | PII scrub → NeMo Guardrails → NeedsPayload → session + eligibility questions |
| POST | `/api/v1/kiosk/route` | Session + answers → merged payload → solve → itinerary |
| POST | `/api/v1/caseworker/briefing` | Shelter stats → NIM summary → briefing text |
| POST | `/api/v1/handoff-script` | Facility + payload → NIM phone script |

**Safety pipeline on caseworker route** (in order):
1. `clean_transcript()` — filler removal + `redact_pii()` (phone, email, SIN, OHIP, postal, date)
2. `has_injection()` — regex injection detection → HTTP 400 if triggered
3. `guardrails_check()` — NeMo Guardrails colang rail check → HTTP 400 if triggered
4. `compile_needs_async()` — LLM triage with PRIVACY RULE prompt

---

## 3. Frontend Module Reference

### `frontend/src/config.ts`

Voice constants mirrored from `backend/config.py` — must sync manually if either changes:
```typescript
VOICE_HOLD_MAX_MS      = 45_000
VOICE_SILENCE_KILL_MS  = 10_000
VOICE_SESSION_IDLE_MS  = 120_000
VOICE_MIN_CHARS        = 10       // used in KioskPage transcript validation
API_BASE               = '/api/v1'
KIOSK_DEFAULT_HUB      = import.meta.env.VITE_KIOSK_HUB ?? 'Union Station'
```

### `frontend/src/types/api.ts`

All API shapes. Import from here — never inline types.

Key types: `NeedsPayload`, `ItineraryResult`, `Itinerary = Record<string, ItineraryResult[]>`, all request/response models.

`CaseworkerRouteResponse` includes `compile_method: 'nim'|'regex'` and latency fields.
`KioskSessionResponse` includes `next_step: 'collect_eligibility'|'route'`.

### `frontend/src/components/GatewayA/CaseworkerPage.tsx`

State machine: `idle -> compiled -> confirmed -> routed`

Origin hardcoded to `(43.6532, -79.3832)` (downtown Toronto — known remaining issue).

Sub-components: VoiceInput, PayloadConfirm, Itinerary, Ticket, HandoffScript, ShiftBriefing, BenchmarkPanel.

### `frontend/src/components/shared/useSpeech.ts`

**TTS:** `pitch=0.85` (calmer), preferred voice list: `Google UK English Female → Samantha → Karen → Moira → Google US English`. Falls back to system default.

**Dual recording (new):** `startRecording()` uses `MediaRecorder` with 250ms timeslice. `stopRecording()` returns `Promise<Blob | null>` — waits for `onstop` to capture final chunk. `transcribeAudio(blob)` POSTs to `/api/v1/transcribe` and returns the ASR transcript string or null.

### `frontend/src/components/GatewayB/VoiceOrb.tsx`

**Tap-to-toggle (changed from hold-to-release).** Props: `{ state, onClick }` (was `onPointerDown`/`onPointerUp`). Labels: `"Tap to speak"` (idle), `"Tap when done"` (listening).

### `frontend/src/components/GatewayB/KioskPage.tsx`

State machine: `idle -> recording -> processing -> eligibility -> routing -> speaking -> done`

Accessibility rule: No text input or form elements. Only VoiceOrb is focusable.

**New interaction model (tap-to-toggle):**
- First tap: `startListening()` (Web Speech for live transcript display) + `startRecording()` (MediaRecorder for ASR NIM)
- Second tap: `stopListening()` + await `stopRecording()` → `transcribeAudio(blob)` → if null fall back to Web Speech `transcript`
- Live transcript shows below orb during `recording` and `processing` states

**Warmer spoken text (all messages updated):** "Welcome. I'm here to help you find shelter, food, or care…", "I'm sorry, I didn't catch that…", etc.

### `frontend/src/components/GatewayB/EligibilityFlow.tsx`

State machine: `speaking_question -> waiting_for_answer -> complete`

Speaks 1-3 questions via TTS, listens for voice answers, calls `onComplete(answers)`.

**Tap to submit early (new):** VoiceOrb `onClick` calls `advanceOrComplete(idx, transcript)` when in `waiting_for_answer` state. Auto-submit on transcript > 3 chars and 30s timeout still work as fallback.

`parseAnswer(question, answer)` — mirrors `backend/voice_session.py::parse_eligibility_answer()` logic.

### `frontend/src/components/GatewayA/PayloadConfirm.tsx`

5-second countdown auto-submits. `submitted = useRef(false)` prevents `onConfirm` double-fire.

---

## 4. Data Files

Location: `data/` (relative to project root)

| File | Size | Records | Key Columns |
|------|------|---------|-------------|
| `shelters.csv` | ~63 KB | ~50 | ORGANIZATION_NAME, SHELTER_ADDRESS, SECTOR, SERVICE_USER_COUNT, CAPACITY_ACTUAL_BED, UNOCCUPIED_BEDS, LAT, LON, requires_id, harm_reduction |
| `rehab_services.csv` | ~8 KB | ~25 | organization_name, address, lat, lon, requires_id, harm_reduction, bypass_pathway, intake_preparation |
| `food_banks.csv` | ~4 KB | ~15 | organization_name, address, lat, lon, phone, hours |
| `grassroots_services.csv` | ~5 KB | ~15 | organization_name, address, lat, lon, service_type |
| `hygiene_stations.csv` | ~4 KB | ~10 | organization_name, address, lat, lon, has_showers, has_laundry, has_winter_clothing |
| `osm_amenities.json` | ~15 KB | ~50+ | elements[].{id, lat, lon, tags.{name, amenity}} |
| `stops.txt` | ~675 KB | ~9,300 | stop_id, stop_name, stop_lat, stop_lon |

Critical convention: shelters use UPPERCASE column names (CKAN format). Do not rename. All other CSVs use lowercase.

---

## 5. Complete Data Flows

### Caseworker Flow (Gateway A)

```
1. Caseworker speaks or pastes text
2. CaseworkerPage.handleTextSubmit(text)
   -> POST /api/v1/caseworker/route {text, origin_lat, origin_lon}
3. Backend: clean_transcript() -> compile_needs() [NIM -> regex fallback]
4. solve(datasets_gpu, GPU_MODE) + solve(datasets_cpu, CPU_MODE) [CPU in async executor]
5. Response: {payload, compile_method, latencies, itinerary, ticket_text}
6. Frontend: PayloadConfirm shown (5s countdown -> auto-submit, or edit)
7. handleConfirm(edited_payload):
   - If payload changed -> re-POST /caseworker/route
   - Else -> use existing result
8. Renders: ItineraryView (top 3 per pillar) + Ticket + HandoffScript modal
```

### Kiosk Flow (Gateway B)

```
1. Public holds VoiceOrb -> startListening
2. Release orb -> stopListening -> validate transcript (>=10 chars)
3. POST /api/v1/kiosk/session {transcript, origin_lat, origin_lon}
4. Backend: compile_needs() -> create_session() -> resolve_eligibility_questions()
5. Response: {session_id, payload_draft, eligibility_questions, next_step}
6. If next_step="collect_eligibility":
   - EligibilityFlow speaks questions via TTS
   - Each: startListening -> transcript -> parseAnswer() -> advance
   - onComplete(answers) -> KioskPage.submitRoute(session_id, answers)
7. POST /api/v1/kiosk/route {session_id, eligibility_answers}
8. Backend: merge payload_draft + answers -> solve() -> build_tts_itinerary_script()
9. Response: {itinerary, tts_script, gpu_solve_ms}
10. KioskItinerary: speaks TTS script -> shows facility cards
11. After VOICE_SESSION_IDLE_MS (120s): resets to idle
```

### Briefing Flow

```
1. POST /api/v1/caseworker/briefing {current_time_iso}
2. Backend: compute total_beds, available_beds, by_sector from shelters dataset
3. generate_briefing(summary) -> NIM -> fallback placeholder
4. Response: {briefing_text, shelter_snapshot: {total_beds, available_beds}}
```

### Handoff Script Flow

```
1. Caseworker clicks "Call" on an itinerary result
2. HandoffScript modal opens
3. POST /api/v1/handoff-script {facility_name, facility_phone, payload}
4. generate_handoff_script(facility_name, payload) -> NIM -> fallback
5. Response: {script, facility, phone}
6. Modal displays script for caseworker to read aloud
```

---

## 6. Agent Rules (Hard Constraints)

From `AGENTS.md` — apply to ALL AI tools working on this codebase:

1. **Every NIM call needs a regex fallback.** Never remove `_regex_fallback()` or its try/except wrappers.

2. **Every cuDF/cuML call needs a pandas/sklearn fallback.** Import GPU libraries inside functions only (module-level import fails on MacBook). After any solver change: `python backend/solver.py --benchmark`.

3. **All FastAPI request/response types use Pydantic models.** No bare dict returns. FastAPI auto-validates.

4. **No hardcoded secrets.** NIM_API_KEY defaults to `"not-needed"` via `os.environ.get()`. NGC_API_KEY from env only.

5. **Shelter CSV columns stay UPPERCASE.** Do NOT rename ORGANIZATION_NAME, SHELTER_ADDRESS, etc. in data_ingestion.py. solver.py references them by uppercase name.

6. **Kiosk (Gateway B) is voice-only.** No text inputs, no form elements. Tab audit: only VoiceOrb should be focusable. Questions are TTS-only.

7. **All user input is PII-scrubbed before LLM.** `pii_scrubber.redact_pii()` is called inside `voice_session.clean_transcript()`. Never bypass. Patterns: phone, email, SIN, OHIP, postal code, dates.

8. **Prompt injection is blocked on Gateway A.** `pii_scrubber.has_injection()` is called after cleaning in `caseworker_route()`. Returns HTTP 400 with a neutral message. Never log the injected text at INFO or above.

---

## 7. Recent Changes Log

### Session 1 — Codebase Improvements

| File | Change |
|------|--------|
| `backend/solver.py` | Removed dead `eligibility_mask()` nested function (was never called) |
| `backend/main.py` | Added `Field(ge=, le=)` validators to lat/lon on all route request models |
| `backend/main.py` | CORS origins from `CORS_ORIGINS` env var; restricted to GET+POST, Content-Type |
| `backend/main.py` | Added background `_session_gc()` asyncio task in lifespan (60s interval) |
| `backend/data_ingestion.py` | Wrapped OSM JSON load in try-except -> empty fallback |
| `backend/nim_compiler.py` | Added `import os`; replaced 3x `api_key="not-needed"` with env var |
| `.gitignore` | Added CLAUDE.md, .claude/, learning/, Python/frontend extras, IDE dirs |

### Session 2 — 9 Logic Gap Fixes

| Fix | File | Change |
|-----|------|--------|
| Transcript min-length | `KioskPage.tsx:64` | Hardcoded `< 5` -> `< VOICE_MIN_CHARS` (10) |
| EligibilityFlow race condition | `EligibilityFlow.tsx:97` | Added `idx`, `flowState` to useEffect deps |
| TTS KeyError | `voice_session.py:161` | `r['name']`/`r['address']` -> `.get()` with fallbacks |
| OSM scoring bias | `data_ingestion.py:148` | `occupancy_ratio = 0.0` -> `0.5` (neutral) |
| Health check NIM endpoint | `main.py:129` | Hardcoded string -> `NIM_ENDPOINT` from config |
| Dead error UI | `KioskPage.tsx` | `setError()` now called in catch blocks; cleared on success |
| Transit longitude conversion | `solver.py:_check_transit` | `73_000` -> `80_000` (Toronto ~80 km/degree) |
| Null payload crash | `main.py:kiosk_route` | Added `or session.payload_draft is None` guard |
| Countdown double-fire | `PayloadConfirm.tsx` | Added `submitted = useRef(false)` gate |

### Session 3 — Stability + Deployment Fixes

| Fix | File | Change |
|-----|------|--------|
| `has_id=None` masking | `solver.py:elig()` | `is False` → `is not True` — conservatively excludes ID-required facilities |
| NIM timeout fast-fail | `nim_compiler.py` | Added `APIConnectionError, APITimeoutError` catch with `break` — skips remaining retries immediately |
| Docker pip cache | `docker-compose.yml` | Added `pip-cache` named volume; dropped `--reload` from backend container |
| GX10 startup script | `start-gx10.sh` | New script: hardware check, .env validation, venv setup, data verify, terminal layout instructions |

### Session 4 — Voice UX + Kiosk Redesign

| Change | File | Detail |
|--------|------|--------|
| TTS voice quality | `useSpeech.ts` | `pitch=0.85`; preferred voice list: Google UK English Female → Samantha → Karen → Moira |
| Tap-to-toggle | `VoiceOrb.tsx` | Props: `onClick` (was `onPointerDown`/`onPointerUp`); labels: "Tap to speak" / "Tap when done" |
| Kiosk interaction | `KioskPage.tsx` | `handleOrbTap` replaces `handleOrbDown`/`handleOrbUp`; dual recording (MediaRecorder + Web Speech) |
| Live transcript | `KioskPage.tsx` | Transcript shown below orb during `recording`/`processing` states |
| Warm spoken text | `KioskPage.tsx` | All 4 TTS messages rewritten: "Welcome. I'm here to help you…" etc. |
| Eligibility tap | `EligibilityFlow.tsx` | VoiceOrb `onClick` submits answer early; auto-submit and timeout still work as fallback |
| Warm TTS script | `voice_session.py` | `build_tts_itinerary_script`: "First, go to…", "Next…", "I hope this helps." |
| NVIDIA ASR NIM | `main.py`, `docker-compose.yml`, `useSpeech.ts` | `POST /api/v1/transcribe`; Parakeet-0.6B-CTC on :9000; `transcribeAudio()` in frontend; `stopRecording()` now async |
| python-multipart | `requirements.txt` | Added — required by FastAPI `UploadFile` |

### Session 5 — PII Guardrails + NeMo Guardrails

| Change | File | Detail |
|--------|------|--------|
| PII scrubber | `backend/pii_scrubber.py` (new) | `redact_pii()`: 6 Canadian PII patterns; `has_injection()`: 7 injection patterns |
| PII in transcript cleaning | `voice_session.py` | `clean_transcript()` calls `redact_pii()` after filler removal |
| Privacy rule in NIM prompt | `config.py` | `NIM_TRIAGE_PROMPT` opens with PRIVACY RULE block: ignore names/addresses/health |
| Input length limits | `main.py` | `text` max 5000, `transcript` max 2000, `client_name` max 100 |
| Remove transcript from logs | `main.py` | Replaced `transcript[:120]` debug log with `"{len} chars"` — no PII in logfiles |
| Injection guard | `main.py:caseworker_route` | `has_injection()` check after cleaning → HTTP 400 with neutral message |
| NeMo Guardrails | `guardrails_client.py` (new), `guardrails/config.yml`, `guardrails/rails.co` | `init_guardrails()` + `check_input()` on both routes; PassthroughLLM for zero inference overhead; colang rails for jailbreak + harmful |
| Health endpoint | `main.py` | `nemo_guardrails: "active"|"disabled"` field added |
| AGENTS.md / CLAUDE.md | governance files | Rules 7 + 8 added; two new Hard Boundaries |

---

## 8. Known Remaining Issues

Not yet fixed — reference for next LLM:

1. ~~**`has_id=None` treated as "has ID"**~~ **FIXED** — `solver.py:elig()` now uses `has_id is not True`, so `None` conservatively excludes ID-required facilities.

2. **Shelter sector mapping incomplete** (`solver.py:_apply_masks()`)
   `sector_map` covers standard values only. Non-standard SECTOR values (e.g. "Couples") silently excluded. Fix: add catch-all or extend the mapping.

3. **No audit trail for caseworker routing** (`main.py:caseworker_route`)
   Gateway A creates no session. Routing decisions are ephemeral. Fix: append to a log file or persist to SQLite.

4. **Frontend/backend config not auto-synced** (`frontend/src/config.ts` vs `backend/config.py`)
   VOICE_* constants are manually mirrored. Fix: add a CI check comparing the values, or generate config.ts from Python.

5. **`parse_eligibility_answer()` never called by backend** (`voice_session.py`)
   Frontend duplicates this logic in `EligibilityFlow.tsx::parseAnswer()`. If patterns change, both files must update. Fix: expose a `/kiosk/parse-answer` endpoint or document that frontend owns this responsibility.

6. **BenchmarkPanel fetch on unmount** (`BenchmarkPanel.tsx`)
   Async fetch may try to set state on unmounted component. Fix: use AbortController in cleanup.

7. ~~**NIM retry loop treats all errors equally**~~ **FIXED** — `nim_compiler.py` now imports `APIConnectionError, APITimeoutError` from openai and `break`s the inner retry loop on either, immediately moving to the next tier instead of waiting 15s × 3 retries.

8. **Caseworker origin hardcoded** (`CaseworkerPage.tsx`)
   `origin_lat: 43.6532, origin_lon: -79.3832` hardcoded. Fix: geolocation API or location picker.

---

## 9. Extension Guide

### Add a New Service Pillar

1. Add CSV to `data/` with: `lat`, `lon`, `organization_name`, `address`, `phone`, `hours`, `requires_id`, `harm_reduction`, `bypass_pathway`, `intake_preparation`
2. Add path constant in `config.py`
3. Add load in `data_ingestion.py::load_all()`: `("new_pillar", NEW_CSV)`
4. Add `needs_new_pillar: bool` field to `NeedsPayload` in `nim_compiler.py`
5. Add mask logic in `solver.py::_apply_masks()`
6. Update `NIM_TRIAGE_PROMPT` in `config.py` to include the new field
7. Update `_regex_fallback()` keywords
8. Frontend itinerary display picks up the new pillar key automatically

### Change Solver Weights

Edit `config.py`: `WEIGHT_DISTANCE`, `WEIGHT_OCCUPANCY`, `WEIGHT_TRANSIT`. Run: `python backend/solver.py --benchmark`

### Add an Eligibility Question

1. Add pillar to `ASK_*_FOR_PILLARS` list in `config.py`
2. Add question string in `voice_session.py::resolve_eligibility_questions()`
3. Add keyword parsing in `voice_session.py::parse_eligibility_answer()`
4. Mirror the parsing in `EligibilityFlow.tsx::parseAnswer()`
5. Add field to `NeedsPayload` and its validator if needed

### Change NIM Prompts

Edit prompts in `config.py`. Test:
```bash
curl -X POST http://localhost:8000/api/v1/caseworker/route \
  -H "Content-Type: application/json" \
  -d '{"text": "I need shelter and food, no ID, been drinking"}'
```

### Switch LLM

Change `NIM_MODEL` in `config.py`. Any OpenAI-spec server works. Triage prompt's JSON schema must be supported by the model.

---

## 10. Testing Checklist

**Backend startup:**
- [ ] `python backend/data_ingestion.py --verify --mode cpu` — datasets load with row counts
- [ ] `uvicorn backend.main:app --reload` starts without errors
- [ ] `GET /api/v1/health` returns `status: ok`, `nemo_guardrails: "disabled"` (default) or `"active"`
- [ ] Startup log shows: `guardrails=active` or `guardrails=disabled`

**PII + injection:**
- [ ] `python3 -c "from backend.pii_scrubber import redact_pii, has_injection; ..."` — verify patterns fire
- [ ] Logs show `"PII redacted: N items"` not transcript content when PII is present
- [ ] `POST /caseworker/route` with `"ignore previous instructions"` → HTTP 400
- [ ] `POST /caseworker/route` with text > 5000 chars → HTTP 422
- [ ] `POST /kiosk/session` with transcript > 2000 chars → HTTP 422

**ASR NIM (when Parakeet container running on :9000):**
- [ ] `curl http://localhost:9000/v1/models` — returns model list
- [ ] `POST /api/v1/transcribe` with valid audio file → `{"transcript": "...", "source": "local"}`
- [ ] Kill container → `POST /api/v1/transcribe` → HTTP 503 (frontend falls back to Web Speech)

**Routing:**
- [ ] `POST /api/v1/caseworker/route` with "need shelter food no ID been drinking" returns itinerary
- [ ] `compile_method` is `"nim"` if LLM running, `"regex"` if not
- [ ] `POST /api/v1/caseworker/route` with `origin_lat=999` returns HTTP 422
- [ ] `POST /kiosk/session` with transcript < 10 chars returns HTTP 400
- [ ] `POST /kiosk/route` with invalid session_id returns HTTP 404

**Solver:**
- [ ] Results sorted by composite_score ascending
- [ ] Shelter results filtered to UNOCCUPIED_BEDS > 0
- [ ] Shelter with `requires_id=True` excluded when `has_id=None` (conservative masking)
- [ ] `python backend/solver.py --benchmark` completes

**Frontend kiosk (Chrome required):**
- [ ] Single tap starts listening + recording; second tap stops both
- [ ] Live transcript appears below orb while recording
- [ ] TTS greeting: "Welcome. I'm here to help you find shelter, food, or care…"
- [ ] Eligibility questions are spoken (not shown as text)
- [ ] Tap during eligibility `waiting_for_answer` submits early
- [ ] Tab audit: only VoiceOrb is focusable

**Frontend caseworker:**
- [ ] VoiceInput → PayloadConfirm (5s countdown) → Itinerary renders
- [ ] ShiftBriefing loads, HandoffScript modal generates script

---

## 11. GX10 Remote Access & GPU Model Setup

> **Full ops guide:** [`gx10_access_and_gpu_guide.md`](gx10_access_and_gpu_guide.md)
> **Day-of checklist:** [`haven_matrix_reference.md`](haven_matrix_reference.md) §4 and §10

### Access summary (gx10-3cd8)

| Field | Value |
|-------|-------|
| Hotspot SSID / password | `gx10-3cd8` |
| SSH | `ssh asus@gx10-3cd8.local` |
| Username / password | `asus` / `password` |
| Tailscale team invite | https://login.tailscale.com/uinv/iC7hHtsfaC215vP2zbheG11 |

The GX10 has **no Wi-Fi**. Initial access: connect laptop to hotspot → SSH → `yes` → `password`. For persistent remote access: install Tailscale on laptop → SSH in → `sudo tailscale up` → authorize URL.

### Architecture (team default)

| Where | What | GPU? |
|-------|------|------|
| **GX10** | `docker compose up nim` (+ optional `asr`) | Yes — models in Docker volumes `nim-cache`, `asr-cache` |
| **Mac** | `uvicorn` + `npm run dev` | No — `FORCE_CPU_SOLVER=1` |

Mac connects via Tailscale: `NIM_ENDPOINT=http://100.81.85.39:8001/v1` (replace with your unit IP).

Models download automatically on first NIM start (NGC); not stored on Mac.

Full steps: [`gx10_access_and_gpu_guide.md`](gx10_access_and_gpu_guide.md) Steps 3–4.
