# Haven Matrix — Implementation Reference & LLM Handoff

> **Last updated:** 2026-05-30 (Session 10 — EDA integration, auth, map view, returning-client detection, capacity ticker, speech improvements)
> **Last commit:** `d1b8de0` (uncommitted changes since then — auth, case store wiring, speech, map, EDA data)
> **Status:** Fully functional in CPU/NIM mode. Auth working (register/login/JWT). Case store saving cases. Map view active. Capacity ticker polling. Speech on `en-IN`. Cloud NIM active if `NGC_API_KEY` set. GPU path requires RAPIDS container on GX10. Frontend on `:5173`.

This document is the authoritative source for continuing work on Haven Matrix. It covers the complete current state of every module, all session changes, known issues, and how to extend the system.

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
+---------------------------------------------------------------+
|                    PRESENTATION LAYER                          |
|  Gateway A (Caseworker — requires login)                      |
|  Gateway B (Kiosk — public, voice-only)                       |
|  React :5173/caseworker  |  React :5173/kiosk                 |
+---------------------------------------------------------------+
                       | HTTP (Vite proxy /api -> :8000)
+---------------------------------------------------------------+
|              FastAPI BACKEND  (port 8000)                      |
|  POST /api/v1/auth/register   POST /api/v1/auth/login         |
|  GET  /api/v1/auth/me                                         |
|  POST /api/v1/caseworker/route                                |
|  POST /api/v1/kiosk/session + /kiosk/route                    |
|  GET  /api/v1/caseworker/{id}/history                         |
|  PATCH /api/v1/case/{id}/outcome                              |
|  GET  /api/v1/capacity                                        |
|  POST /api/v1/transcribe  |  POST /api/v1/caseworker/briefing |
|  POST /api/v1/handoff-script                                  |
|  GET  /api/v1/health  |  /benchmark  |  /system  |  /telemetry|
+---------------------------------------------------------------+
           |                            |
+---------------------+   +--------------------------+
|  SAFETY LAYER       |   |  ASR (port 9000, optional)|
|  pii_scrubber.py    |   |  Parakeet-0.6B-CTC NIM   |
|  NeMo Guardrails    |   |  Web Speech API fallback  |
|  crisis_gate.py     |   +--------------------------+
+---------------------+
           |
+---------------------------------------------------------------+
|     LLM INFERENCE (4-tier chain)                              |
|     cloud NIM (NGC_API_KEY) → llama.cpp :30000 →              |
|     NIM container :8001 → regex fallback (always works)       |
+---------------------------------------------------------------+
                       |
+---------------------------------------------------------------+
|     PERSISTENCE                                               |
|     logs/cases.db  SQLite — users + cases (auth + history)   |
|     TF-IDF cosine  sklearn — similar-case RAG lookup         |
+---------------------------------------------------------------+
                       |
+---------------------------------------------------------------+
|     GPU DATA (RAPIDS — 128 GB unified memory on GX10)         |
|     cuDF: 10 datasets loaded. cuML KNN haversine < 10ms       |
|     CPU fallback: pandas + scikit-learn (~400ms)              |
+---------------------------------------------------------------+
```

### Tech Stack

| Layer | Tech | Why |
|-------|------|-----|
| LLM | Nemotron-30B via llama.cpp | Fits in 128 GB unified memory; deterministic JSON |
| LLM fallback | Gemma 3n E4B via NIM container (:8001) | NVFP4 on Blackwell; same OpenAI API |
| ASR | Parakeet-0.6B-CTC NIM (:9000) | NVIDIA speech; ~3 GB; Web Speech fallback |
| Auth | passlib[bcrypt==4.0.1] + python-jose (JWT HS256) | Email+password; 24h tokens |
| Case store | SQLite (stdlib) + TF-IDF (sklearn) | Zero deps; RAG lookup; upgrade path = ChromaDB |
| Guardrails | NeMo Guardrails + pii_scrubber.py | Colang rails; Canadian PII redaction |
| Backend | FastAPI + uvicorn | Async; Pydantic validation; auto Swagger |
| GPU compute | cuDF + cuML (RAPIDS) | Zero-copy KNN < 10ms vs ~400ms pandas |
| Frontend | React + Vite + TypeScript | Dual-recording; protected routes |
| Voice (STT) | Web Speech API (`en-IN`) → Parakeet ASR NIM | Browser-native; Indian English locale |
| Voice (TTS) | speechSynthesis (browser) | pitch=0.85; preferred voice list |
| Map | Leaflet (lazy-loaded) | Colored pins per pillar; no API key needed |

---

## 2. Backend Module Reference

### `backend/config.py` — All Constants

No logic. Tune everything here.

**File paths:**
```python
DATA_DIR        = Path("data")
LOG_DIR         = Path("logs")
CASE_DB_PATH    = LOG_DIR / "cases.db"    # SQLite — users + cases
SHELTERS_CSV    = DATA_DIR / "shelters.csv"
REHAB_CSV       = DATA_DIR / "rehab_services.csv"
FOOD_CSV        = DATA_DIR / "food_banks.csv"
HYGIENE_CSV     = DATA_DIR / "hygiene_stations.csv"   # 817 rows after EDA integration
GRASSROOTS_CSV  = DATA_DIR / "grassroots_services.csv"
OSM_JSON        = DATA_DIR / "osm_amenities.json"
GTFS_STOPS_TXT  = DATA_DIR / "stops.txt"
YOUTH_SPACES_CSV = DATA_DIR / "youth_spaces.csv"
LIBRARIES_CSV   = DATA_DIR / "libraries.csv"
RESPITE_CSV     = DATA_DIR / "respite_sites.csv"      # 1,599 rows after EDA integration
```

**LLM endpoints:**
```python
NVIDIA_CLOUD_ENDPOINT = "https://integrate.api.nvidia.com/v1"   # Tier 1 (needs NGC_API_KEY)
NVIDIA_CLOUD_MODEL    = "google/gemma-3n-e4b-it"
NIM_ENDPOINT    = os.environ.get("NIM_ENDPOINT", "http://localhost:30000/v1")  # Tier 2 llama.cpp
NEMOTRON_MODEL  = "nemotron"
NIM_FALLBACK    = os.environ.get("NIM_FALLBACK", "http://localhost:8001/v1")   # Tier 3 NIM container
NIM_MODEL       = "google/gemma-3n-e4b-it"
NIM_TIMEOUT_SEC = 15
NIM_MAX_RETRIES = 2
FORCE_CPU_SOLVER = os.environ.get("FORCE_CPU_SOLVER", "0").lower() in ("1","true","yes")
```

**ASR constants:**
```python
ASR_NIM_URL     = os.environ.get("ASR_NIM_URL", "http://localhost:9000")
ASR_CLOUD_URL   = os.environ.get("ASR_CLOUD_URL", "https://integrate.api.nvidia.com/v1")
ASR_NIM_TIMEOUT = 30
```

**Auth constants (in auth_store.py, not config.py):**
```python
JWT_SECRET    = os.environ.get("JWT_SECRET", "haven-matrix-dev-secret-change-in-prod")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_H  = 24
```
**CRITICAL:** Set `JWT_SECRET` in `.env` for production. Default is insecure.

**Solver weights:**
```python
WEIGHT_DISTANCE  = 0.60
WEIGHT_OCCUPANCY = 0.30
WEIGHT_TRANSIT   = 0.10
TRANSIT_RADIUS_M = 200
KNN_RESULTS_PER_PILLAR = 3
```

**Voice timeouts (frontend `config.ts` must mirror these manually):**
```python
VOICE_HOLD_MAX_SEC         = 45
VOICE_SILENCE_KILL_SEC     = 2.5   # reduced from 10 — natural pause
VOICE_SESSION_IDLE_SEC     = 120
VOICE_ELIGIBILITY_WAIT_SEC = 30
VOICE_MIN_TRANSCRIPT_CHARS = 10
```

**Kiosk hub coordinates — 12 locations:**
All data-driven from `shelters.csv` clustering.
```python
KIOSK_HUBS = {
    "Moss Park / Sherbourne":   (43.6530, -79.3680),
    "Seaton House / George St": (43.6545, -79.3706),
    "Regent Park":              (43.6584, -79.3606),
    "Union Station":            (43.6452, -79.3806),
    "Yonge & Dundas":           (43.6561, -79.3802),
    "Spadina & Dundas":         (43.6538, -79.4004),
    "Parkdale":                 (43.6478, -79.4490),
    "Bloor & Christie":         (43.6620, -79.4200),
    "Danforth & Pape":          (43.6782, -79.3541),
    "Scarborough Centre":       (43.7731, -79.2570),
    "Etobicoke Civic":          (43.6435, -79.5605),
    "North York Centre":        (43.7680, -79.4130),
}
# Empty VITE_KIOSK_HUB (default) = always show hub selector on kiosk start
```

---

### `backend/auth_store.py` — Auth (NEW)

SQLite-backed caseworker auth sharing `logs/cases.db`.

**Schema:** `users(id, email UNIQUE, name, password_hash, role DEFAULT caseworker, created_at)`

**CRITICAL DEPENDENCY NOTE:** `bcrypt==4.0.1` is pinned in `requirements.txt`. Do NOT upgrade.
`passlib 1.7.4` is incompatible with `bcrypt >= 4.1` (the `__about__` attribute was removed).
Upgrading bcrypt will cause all password operations to fail with an obscure error.

**Key methods:**
```python
create_user(email, name, password) -> dict   # raises ValueError on duplicate email
authenticate(email, password) -> dict | None  # returns user dict or None
get_by_email(email) -> dict | None
create_token(user) -> str                    # JWT, expires in 24h
AuthStore.decode_token(token) -> dict | None # static method; returns payload or None
```

**JWT payload:** `{"sub": email, "name": name, "role": role, "exp": ...}`

**Initialization:** Must be in `global` declaration of lifespan:
```python
global datasets_gpu, datasets_cpu, _rapids_mode, _telemetry_header_written, case_store, auth_store
auth_store = AuthStore(str(CASE_DB_PATH))
```
Missing `auth_store` from the `global` statement means it stays `None` — every auth request returns 503.

---

### `backend/case_store.py` — SQLite Case History

SQLite-backed case persistence at `logs/cases.db`. Uses Python built-in `sqlite3`.
TF-IDF similarity via `sklearn.feature_extraction.text.TfidfVectorizer` (already in requirements).

**Schema:** `cases(id, caseworker_id, client_name, created_at, transcript, needs_json, itinerary_json, ticket_text, outcome DEFAULT pending, outcome_notes, updated_at)`

**WAL mode enabled** — safe for concurrent FastAPI requests.

**Key methods:**
```python
save_case(caseworker_id, client_name, transcript, needs_payload, itinerary, ticket_text) -> case_id (8-char hex)
get_history(caseworker_id, limit=30) -> list[dict]
update_outcome(case_id, outcome, notes="") -> bool   # outcomes: pending|placed|declined|returned|referred_elsewhere
find_similar(transcript, limit=3) -> list[dict]      # TF-IDF cosine over resolved cases only
```

**`find_similar()` detail:**
- Only considers cases with `outcome != 'pending'` (resolved cases give signal)
- Uses `TfidfVectorizer(stop_words='english', max_features=1000, sublinear_tf=True)`
- Minimum similarity threshold: 0.08 to include
- Returns each match with `similarity` (float) and `placed_at` (first shelter name from itinerary_json)
- Returns `[]` silently on error — never raises

**Returning client detection threshold:** `similarity >= 0.35` triggers `returning_hint` in route response.

**Upgrade path:** Replace `find_similar()` with ChromaDB + sentence-transformers for dense-vector search in production.

---

### `backend/nim_compiler.py` — LLM Client

**NeedsPayload (Pydantic):**
```python
needs_shelter, needs_rehab, needs_food, needs_supplies, needs_hygiene: bool
needs_youth_service, needs_library, needs_respite: bool = False
sector: str = "any"           # validated: youth|adult|family|any
has_id: bool | None = None
sobriety_status: str | None = None   # sober|using|None
group_size: str | None = None        # alone|with_family|None
```

**`compile_needs(text, similar_cases=None) -> (NeedsPayload, method, latency_ms)`:**

4-tier chain:
```
Tier 1: NVIDIA cloud NIM   (NGC_API_KEY required; fastest)
Tier 2: llama.cpp :30000   (NIM_ENDPOINT; Nemotron-30B)
Tier 3: NIM container :8001 (NIM_FALLBACK; Gemma 3n E4B)
Tier 4: _regex_fallback()   (pure keywords; always works; no network)
```

**RAG context injection:**
`_build_triage_user_message(text, similar_cases)` prepends resolved past cases as LLM context:
```
[CONTEXT: Similar resolved cases — use to calibrate sector and needs extraction]
• "male no id needs shelter cold..." → Seaton House | outcome: placed
• "woman with children urgent..." → Dixon Hall Family | outcome: placed

[CURRENT CLIENT NOTES]
<text>
```
This improves sector detection and needs extraction by showing the LLM patterns from this caseworker's caseload.

**`_check_grounding(script, facility_name)`:** Post-generation guard on handoff scripts. Verifies the script mentions the actual facility name. Appends correction if missing. Never raises.

**`compile_needs_async(text, similar_cases=None)`:** Async wrapper via `asyncio.to_thread`.

---

### `backend/solver.py` — Constraint-Aware KNN

**`solve(payload, datasets, origin, mode) -> (itinerary_dict, elapsed_ms)`**

**Scoring formula:** `composite_score = 0.60 × dist_norm + 0.30 × occupancy + 0.10 × transit_binary`
Lower is better. Closed facilities get +2.0 penalty (sink not hide).

**Pillar merging:**
- `food` = food_banks + grassroots
- `hygiene` = hygiene_stations + osm

**Result fields per facility:**
```
pillar, name, address, lat, lon, distance_km, distance_walk_min,
occupancy_ratio, transit_accessible, composite_score, open_now,
phone, hours, requires_id, harm_reduction, bypass_pathway,
intake_preparation, accessible
```

**`is_open_now(hours_str)`:** Parses `"24/7"`, `"Mon-Fri 9am-5pm"`, `"Daily HH:MM-HH:MM"` etc. Fails open (True) for blank/unparseable — never penalizes missing data.

---

### `backend/main.py` — FastAPI App

**Global state:**
```python
datasets_gpu: dict          # GPU-backed (or CPU fallback)
datasets_cpu: dict          # Always CPU
_last_benchmark: dict       = {"gpu_ms": None, "cpu_ms": None}
_rapids_mode: str           = "cpu"
_telemetry_header_written: bool = False
case_store: CaseStore | None = None
auth_store: AuthStore | None = None   # NEW — must be in global declaration
```

**Lifespan startup order:**
1. `case_store = CaseStore(...)` + `auth_store = AuthStore(...)` (same `cases.db`)
2. GPU load → CPU load (fallback if GPU unavailable)
3. `init_guardrails()`
4. `fetch_weather_alert()`
5. Start `_session_gc()` + `_hydration_loop()` asyncio tasks

**Request models:**
```python
CaseworkerRouteRequest:   text(max 5000), origin_lat, origin_lon,
                          client_name(optional), caseworker_id(optional)
AuthRegisterRequest:      email(max 120), name(min 1), password(min 6, max 128)
AuthLoginRequest:         email, password
OutcomeUpdateRequest:     outcome(pattern: pending|placed|declined|returned|referred_elsewhere),
                          notes(max 500)
```

**`_cw_id_from_request(request, fallback)`:** Extracts caseworker identity from JWT Bearer token if present, else uses provided `caseworker_id` field. JWT email takes priority — backward compatible.

**Safety pipeline on caseworker route (in order):**
1. `clean_transcript()` → `redact_pii()` (phone, email, SIN, OHIP, postal, dates)
2. `has_injection()` → HTTP 400 if triggered
3. `guardrails_check()` → HTTP 400 if triggered
4. `is_crisis()` → HTTP 200 with `crisis:True` + escalation (short-circuits LLM)
5. `case_store.find_similar(cleaned, limit=3)` → build `similar_cases` + `returning_hint`
6. `compile_needs_async(cleaned, similar_cases)` → `NeedsPayload`
7. `solve()` GPU + CPU in parallel
8. `case_store.save_case(...)` → `case_id` returned in response

**All endpoints:**

| Method | Path | Auth | What it does |
|--------|------|------|--------------|
| POST | `/api/v1/auth/register` | None | Create account → JWT |
| POST | `/api/v1/auth/login` | None | Email+password → JWT |
| GET | `/api/v1/auth/me` | Bearer | Verify token → user info |
| GET | `/api/v1/health` | None | Status, mode, dataset counts, guardrails |
| GET | `/api/v1/benchmark` | None | Last GPU/CPU solve times |
| GET | `/api/v1/system` | None | Live GPU utilization (pynvml) |
| GET | `/api/v1/capacity` | None | Bed counts + occupancy% from shelters dataset |
| GET | `/api/v1/telemetry/summary` | None | Shadow Census CSV aggregate stats |
| POST | `/api/v1/transcribe` | None | Audio blob → Parakeet ASR NIM → transcript |
| POST | `/api/v1/caseworker/route` | Optional JWT | Full routing pipeline; saves case if authed |
| GET | `/api/v1/caseworker/{id}/history` | None | Past cases for caseworker |
| PATCH | `/api/v1/case/{id}/outcome` | None | Mark outcome: placed/declined/returned/etc. |
| POST | `/api/v1/kiosk/session` | None | Voice transcript → NeedsPayload + session |
| POST | `/api/v1/kiosk/route` | None | Session + eligibility → itinerary |
| POST | `/api/v1/caseworker/briefing` | None | Shelter stats → LLM briefing text |
| POST | `/api/v1/handoff-script` | None | Facility + payload → phone script |

**`caseworker/route` response (full shape):**
```json
{
  "crisis": false,
  "payload": { ...NeedsPayload... },
  "compile_method": "nim|regex|crisis_gate",
  "nim_latency_ms": 234.1,
  "gpu_solve_ms": 8.3,
  "cpu_solve_ms": 401.2,
  "speedup": 48.3,
  "itinerary": { "shelter": [...], "food": [...] },
  "ticket_text": "First, go to...",
  "eligibility_questions": [],
  "case_id": "f2cbb754",
  "returning_hint": {
    "case_id": "abc12345",
    "last_seen": "2026-05-28",
    "placed_at": "Seaton House",
    "outcome": "placed",
    "similarity": 0.72,
    "client_name": "John"
  }
}
```
`returning_hint` is `null` if no similar resolved case with similarity >= 0.35.

---

### `backend/crisis_gate.py` — Deterministic Crisis Detection

Runs BEFORE any LLM call. No network dependency. High recall over precision.

Pattern groups: `mental_health` → 988, `medical/violence` → 911.

**Integration:** Called after guardrails, before `compile_needs()` on both gateways.

---

### `backend/pii_scrubber.py` — PII Redaction + Injection Detection

**`redact_pii(text)`:** Replaces Canadian PII (phone, email, SIN, OHIP, postal, dates) with `[REDACTED]`.
**`has_injection(text)`:** Detects 7 prompt injection patterns. Gateway A only.

---

### `backend/voice_session.py` — Kiosk Session Logic

**In-memory store** — sessions expire after 120s.

Key functions: `create_session`, `get_session`, `clean_transcript`, `build_tts_itinerary_script`, `resolve_eligibility_questions`.

`clean_transcript()` calls `redact_pii()` before any LLM sees text.

---

### `backend/case_store.py` — See §2 (CaseStore section above)

### `backend/auth_store.py` — See §2 (AuthStore section above)

### `backend/guardrails_client.py` — NeMo Guardrails

`GUARDRAILS_ENABLED=1` env var required to enable. Fail-open on error. `PassthroughLLM` — zero inference overhead.

---

## 3. Frontend Module Reference

### `frontend/src/config.ts`

```typescript
VOICE_HOLD_MAX_MS     = 45_000
VOICE_SILENCE_KILL_MS = 2_500   // CHANGED from 10_000 — natural 2.5s pause
VOICE_SESSION_IDLE_MS = 120_000
VOICE_MIN_CHARS       = 10
API_BASE              = '/api/v1'
KIOSK_HUBS            // 12 locations matching backend config.py
KIOSK_DEFAULT_HUB     = import.meta.env.VITE_KIOSK_HUB || ''  // empty = always show picker
```

### `frontend/src/types/api.ts`

All API shapes — import from here only.

**New types added (Session 10):**
```typescript
CaseOutcome = 'pending' | 'placed' | 'declined' | 'returned' | 'referred_elsewhere'

CaseRecord {
  id, caseworker_id, client_name, created_at, transcript,
  needs: NeedsPayload | null,
  itinerary: Itinerary | null,
  ticket_text, outcome: CaseOutcome, outcome_notes, updated_at
}

ReturningClientHint { case_id, last_seen, placed_at, outcome, similarity, client_name }
CapacityResponse    { total_beds, available_beds, occupied_beds, occupancy_pct }
AuthUser            { email, name, role }
AuthResponse        { token, user: AuthUser }
CaseworkerHistoryResponse { cases: CaseRecord[], total }
OutcomeUpdateRequest { outcome: CaseOutcome, notes? }
```

`CaseworkerRouteResponse` now includes `case_id?: string` and `returning_hint?: ReturningClientHint`.

### `frontend/src/context/AuthContext.tsx` (NEW)

React context providing `{ user, token, loading, login, register, logout }`.

- On mount: reads `haven_auth_token` from localStorage → validates via `GET /auth/me` → restores session or clears on expired/invalid token
- `login()` / `register()` → POST to backend → `applyToken()` sets axios default `Authorization: Bearer <token>` header + localStorage
- `logout()` clears both
- `loading: true` while validating stored token — `ProtectedCaseworker` in App.tsx shows spinner during this

### `frontend/src/components/Auth/LoginPage.tsx` (NEW)

Tabbed Sign In / Create Account form. Matches project's dark teal design language.

- Tab: `login` → email + password
- Tab: `register` → email + name + password
- On success → `navigate('/caseworker', { replace: true })`
- Error display for duplicate email (409), wrong credentials (401), server errors

### `frontend/src/App.tsx`

```tsx
<AuthProvider>
  <BrowserRouter>
    <Routes>
      <Route path="/login"      element={<LoginPage />} />
      <Route path="/caseworker" element={<ProtectedCaseworker />} />  // redirects to /login if no auth
      <Route path="/kiosk"      element={<KioskPage />} />             // always public
      <Route path="*"           element={<Navigate to="/caseworker" />} />
    </Routes>
  </BrowserRouter>
</AuthProvider>
```

`ProtectedCaseworker`: shows spinner while auth loading, redirects to `/login` if no user.

### `frontend/src/api/client.ts`

Axios instance at `/api/v1`. The `Authorization: Bearer <token>` header is set by `AuthContext.applyToken()` on `api.defaults.headers.common`. All subsequent requests carry it automatically.

### `frontend/src/components/GatewayA/CaseworkerPage.tsx`

State machine: `idle → compiled → confirmed → routed | crisis`

**Identity:** `caseworker_id = user?.email` (from `useAuth()` — JWT). The old localStorage name input is removed. Caseworker name shown in header alongside Sign Out button.

**New visual elements:**
- `<CapacityTicker />` in header (live bed count + occupancy bar)
- Returning client hint banner (purple) rendered if `routeResult.returning_hint` present
- `<RouteMap />` above itinerary results (collapsible Leaflet map)
- `<CaseworkerHistory />` below ShiftBriefing (collapsible past cases panel)

**Origin still hardcoded:** `originLat = 43.6532, originLon = -79.3832` — known remaining issue.

### `frontend/src/components/GatewayA/CaseworkerHistory.tsx` (NEW)

Collapsible panel. Polls `GET /caseworker/{caseworker_id}/history` on mount and after each new route (`refreshTrigger` prop increment).

Per case row: client name, date, need icons (🏠🍽🚿💊🛋), first placement, outcome badge.
Expanded detail: transcript excerpt, itinerary summary, outcome update buttons (Placed / Declined / Returned / Referred Elsewhere).

### `frontend/src/components/GatewayA/RouteMap.tsx` (NEW)

Leaflet map, lazy-loaded via dynamic `import('leaflet')` (zero bundle cost until first open).
Leaflet CSS loaded via `@import 'leaflet/dist/leaflet.css'` in `index.css`.

- Origin marker: white circle with teal ring
- Per-pillar colored markers: shelter=#1A7A9A, rehab=#3A8A71, food=#D97706, hygiene=#506170, respite=#7C3AED, youth=#0891B2, libraries=#B45309
- First result per pillar = larger pin (14px); others = smaller (10px)
- Click popup: pillar, name, address, phone, walk time, occupancy
- `map.fitBounds()` to show all markers + origin
- Cleanup: `map.remove()` on unmount prevents memory leaks

### `frontend/src/components/GatewayA/CapacityTicker.tsx` (NEW)

Polls `GET /api/v1/capacity` every 60s. Silent on error (backend may not be up yet).

Displays in header: animated pulse dot (green/amber/red by pressure) + occupancy bar + % + beds-free + last-updated time.

Thresholds: `pct >= 97` = Critical (red), `pct >= 93` = High pressure (amber), else Normal (green).

### `frontend/src/components/shared/useSpeech.ts`

**Key changes from Session 10:**

```typescript
// STT language: en-IN (Indian English — handles Indian accents better than en-US)
sr.lang = 'en-IN';

// TTS: stays en-US (en-IN TTS voices rarely installed)
utt.lang = 'en-US';

// Continuous mode auto-restart:
// wantListeningRef tracks whether caller still wants listening
// If Chrome terminates recognition (network blip, ~60s timeout),
// onend checks wantListeningRef and rebuilds+restarts the recognizer
// finalTextRef accumulates confirmed-final text across restarts

// Proper result accumulation:
// Uses e.resultIndex to process only new results
// Separates final (isFinal=true) from interim
// finalTextRef += final text; setTranscript(finalTextRef + currentInterim)

// Audio constraints on getUserMedia (for MediaRecorder / Parakeet NIM):
audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }

// TTS voice cache:
// voiceschanged event fires once when browser loads voices
// cachedVoices module-level array populated via event listener
// speak() uses cachedVoices instead of getVoices() (which returns [] on first call)

// Listening state accuracy:
// isListening set to true in sr.onstart (not before sr.start())
// Avoids "listening" UI during ~300ms startup gap
```

**`startListening(continuous = false)`:**
- `continuous=false` for hold-to-speak (VoiceInput) and eligibility questions (EligibilityFlow)
- `continuous=true` for kiosk main recording (KioskPage) — enables auto-restart

### `frontend/src/components/GatewayB/KioskPage.tsx`

State machine: `idle → hub_select → recording → processing → [crisis|eligibility|routing|speaking|done]`

Text fallback (`typing` state): full-screen textarea, 1.2rem font, autoFocus.

Hub selector: always shows on first load (KIOSK_DEFAULT_HUB is empty by default).

### `frontend/src/components/GatewayB/EligibilityFlow.tsx`

Uses `startListening(false)` — non-continuous (short yes/no answers).

### `frontend/src/components/GatewayA/Itinerary.tsx`

Unchanged. Picks up any new pillar keys automatically from the itinerary dict.

---

## 4. Data Files

Location: `data/` (relative to project root)

| File | Records | Key columns | Notes |
|------|---------|-------------|-------|
| `shelters.csv` | ~290 | ORGANIZATION_NAME, SHELTER_ADDRESS, SECTOR, LAT, LON, CAPACITY_ACTUAL_BED, UNOCCUPIED_BEDS, SERVICE_USER_COUNT, requires_id, harm_reduction | UPPERCASE — CKAN format. Do NOT rename. |
| `rehab_services.csv` | ~25 | organization_name, address, lat, lon, requires_id, harm_reduction, bypass_pathway, intake_preparation | |
| `food_banks.csv` | ~20 | organization_name, address, lat, lon, phone, hours | |
| `grassroots_services.csv` | ~20 | organization_name, address, lat, lon, service_type | |
| `hygiene_stations.csv` | **817** | organization_name, address, lat, lon, has_showers, has_laundry, has_winter_clothing, hours, phone, requires_id, harm_reduction, bypass_pathway, intake_preparation | 15 curated + 798 drinking fountains + 4 public washrooms from EDA |
| `respite_sites.csv` | **1,599** | organization_name, address, lat, lon, hours, phone, pet_friendly, wheelchair_accessible, storage_available, requires_id, harm_reduction, bypass_pathway, intake_preparation, occupancy_ratio, sector | 15 curated + 1,407 places of worship + 177 cooling centres from EDA |
| `youth_spaces.csv` | ~20 | organization_name, address, lat, lon | |
| `libraries.csv` | ~20 | organization_name, address, lat, lon | |
| `osm_amenities.json` | ~55 | elements[].{id, lat, lon, tags.{name, amenity}} | |
| `stops.txt` | ~9,368 | stop_id, stop_name, stop_lat, stop_lon | GTFS format |

**CRITICAL:** Shelter CSV uses UPPERCASE column names (CKAN format). All other datasets use lowercase. Never rename shelter columns — `solver.py` and `data_ingestion.py` reference them explicitly.

**EDA data source:** `EDA/data/processed/` contains parquets that fed the dataset expansions:
- `processed_places_of_worship.parquet` (1,407 rows, `lon`/`lat` columns)
- `processed_cooling_centres.parquet` (177 rows)
- `processed_fountains.parquet` (798 rows)
- `processed_washrooms.parquet` (4 rows)
- `shelter_daily.parquet` — occupancy time series (1,893 days)
- `weather_daily.parquet` — daily weather (temp, precip, snow)
- `shelter_locations.parquet` — 107 geocoded shelter locations

**EDA `.gitignore`** (`EDA/.gitignore`): excludes `.venv/` (660 MB), `.antigravitycli/`, `data/raw/shelter__daily-*.csv` (13-15 MB each), `data/raw/*.csv.csv` (accidental duplicate downloads).

---

## 5. Complete Data Flows

### Caseworker Flow (Gateway A) — Full Pipeline

```
1. User visits /caseworker → ProtectedCaseworker checks auth
   → if no token: redirect to /login
   → if token present: validate via GET /auth/me → restore session

2. Login/Register → POST /auth/login or /auth/register
   → JWT stored in localStorage('haven_auth_token')
   → axios default header set: Authorization: Bearer <token>

3. CapacityTicker polls GET /capacity every 60s → shows bed count in header

4. Caseworker enters client notes (voice or text)
   → POST /api/v1/caseworker/route {text, origin_lat, origin_lon, caseworker_id from JWT}

5. Backend pipeline:
   a. _cw_id_from_request() extracts email from JWT
   b. clean_transcript() → redact_pii()
   c. has_injection() → block if triggered
   d. guardrails_check() → block if triggered
   e. is_crisis() → return crisis response if triggered
   f. case_store.find_similar(cleaned) → similar_cases + returning_hint (if score >= 0.35)
   g. compile_needs_async(cleaned, similar_cases) → NeedsPayload + method + latency
   h. solve() GPU + CPU parallel
   i. case_store.save_case() → case_id stored in logs/cases.db
   j. Return itinerary + case_id + returning_hint

6. Frontend:
   a. If returning_hint present: purple banner shown
   b. PayloadConfirm shown (5s countdown → auto-submit)
   c. On confirm: RouteMap (Leaflet) + ItineraryView + Ticket rendered
   d. CaseworkerHistory refreshed (historyRefresh incremented)
   e. Caseworker can mark outcome → PATCH /case/{id}/outcome
```

### Kiosk Flow (Gateway B)

```
1. Hub selector shown (no auth required)
2. User taps VoiceOrb → startListening(continuous=true) + startRecording()
3. Second tap → stopListening() + stopRecording()
4. transcribeAudio(blob) → POST /api/v1/transcribe (tries Parakeet NIM)
   → if fails: use Web Speech transcript as fallback
5. POST /kiosk/session → NeedsPayload + session_id + eligibility_questions
6. EligibilityFlow: TTS questions → Web Speech answers → onComplete(answers)
7. POST /kiosk/route → itinerary + tts_script
8. Kiosk speaks tts_script → shows facility cards
9. Auto-reset after 120s idle
```

### Auth Flow

```
Register:  POST /auth/register {email, name, password} → {token, user}
Login:     POST /auth/login {email, password} → {token, user}
           JWT stored in localStorage; axios default header set
Verify:    GET /auth/me {Authorization: Bearer token} → {email, name, role}
           Called on page load to restore session
Logout:    Clear localStorage + delete axios header
```

---

## 6. Agent Rules (Hard Constraints)

From `AGENTS.md` — ALL AI tools must follow these:

1. **Every NIM call needs a regex fallback.** Never remove `_regex_fallback()` or its try/except wrappers.

2. **Every cuDF/cuML call needs a pandas/sklearn fallback.** Import GPU libraries inside functions only. After any solver change: `python backend/solver.py --benchmark`.

3. **All FastAPI request/response types use Pydantic models.** No bare dict returns.

4. **No hardcoded secrets.** `NIM_API_KEY` defaults to `"not-needed"`. `NGC_API_KEY` from env only. `JWT_SECRET` MUST be overridden in production via env var.

5. **Shelter CSV columns stay UPPERCASE.** Do NOT rename ORGANIZATION_NAME, SHELTER_ADDRESS, etc. CKAN returns them uppercase. `solver.py` references them by uppercase name.

6. **Kiosk (Gateway B) is voice-first.** `typing` state is the only text fallback. Tab key must land only on VoiceOrb. `🎤 Switch to voice` always present on typing screen.

7. **All user input is PII-scrubbed before LLM.** `pii_scrubber.redact_pii()` called inside `clean_transcript()`. Never bypass.

8. **Prompt injection is blocked on Gateway A.** `has_injection()` called after cleaning. HTTP 400 with neutral message. Never log injected text at INFO or above.

9. **`bcrypt==4.0.1` is PINNED.** Do not upgrade. `passlib 1.7.4` breaks with `bcrypt >= 4.1`.

10. **`auth_store` must be in the `global` declaration of lifespan.** Missing it means auth stays `None` and all `/auth/*` endpoints return 503.

---

## 7. Recent Changes Log

### Sessions 1–9 (summarized)

Sessions 1-9 established: structured logging, 9 logic gap fixes, Docker stability, voice UX redesign, PII scrubber, NeMo guardrails, crisis gate, open-now filter, grounding guard, kiosk hub expansion to 12 locations, kiosk text fallback, SQLite case store (initially unconnected).

Full details for sessions 1-9 are in the git history and earlier versions of this file.

---

### Session 10 — EDA Integration, Auth, Map, Returning Client, Capacity Ticker, Speech

#### EDA Data Integration

| Change | Detail |
|--------|--------|
| `data/respite_sites.csv` | 15 → 1,599 rows: +1,407 geocoded places of worship + 177 cooling centres from `EDA/data/processed/` |
| `data/hygiene_stations.csv` | 15 → 817 rows: +798 drinking fountains + 4 public washrooms from EDA |
| `EDA/.gitignore` | Added: `.venv/` (660 MB), `data/raw/shelter__daily-*.csv` (13-15 MB each), `data/raw/*.csv.csv` (accidental duplicates) |
| EDA validated findings | H1: 96.8% occupancy; H2: 105 shelters; H3: 4,012 Central Intake calls/day; H6: weather correlation; H7: 1,584 respite hubs; H8: 802 hygiene assets |

#### Auth System

| Change | Detail |
|--------|--------|
| `backend/auth_store.py` (new) | SQLite users table in `logs/cases.db`; bcrypt passwords; JWT HS256 24h tokens |
| `backend/requirements.txt` | Added `passlib[bcrypt]==1.7.4`, `bcrypt==4.0.1` (PINNED), `python-jose[cryptography]==3.3.0` |
| `backend/main.py` | `AuthRegisterRequest`, `AuthLoginRequest`, `auth_store` global, 3 auth endpoints, `_cw_id_from_request()` JWT extractor |
| `frontend/src/context/AuthContext.tsx` (new) | React context: login/register/logout/session restore |
| `frontend/src/components/Auth/LoginPage.tsx` (new) | Tabbed Sign In/Create Account form |
| `frontend/src/App.tsx` | `AuthProvider` wrapping, `/login` route, `ProtectedCaseworker` wrapper |
| Bug fixed | `global auth_store` missing from lifespan → 503 on all auth requests. Fixed by adding to `global` declaration |
| Bug fixed | `bcrypt >= 4.1` drops `__about__` → passlib raises obscure error masked as 409. Fixed by pinning `bcrypt==4.0.1` |

#### Case Store Fully Wired

| Change | Detail |
|--------|--------|
| `backend/main.py` | `_cw_id_from_request()` extracts caseworker identity from JWT; `case_store.find_similar()` called before LLM; `case_store.save_case()` called after routing; `case_id` returned in response |
| `backend/main.py` | `returning_hint` computed: if top similar case has `similarity >= 0.35`, includes `{case_id, last_seen, placed_at, outcome, similarity, client_name}` in response |
| `backend/main.py` | Two new endpoints: `GET /caseworker/{id}/history`, `PATCH /case/{id}/outcome` |
| `frontend/src/types/api.ts` | `CaseRecord`, `CaseOutcome`, `ReturningClientHint`, `CaseworkerHistoryResponse`, `OutcomeUpdateRequest` types added |

#### Map View

| Change | Detail |
|--------|--------|
| `frontend/src/components/GatewayA/RouteMap.tsx` (new) | Leaflet lazy-loaded; colored pins per pillar; origin marker; click popups; fitBounds; collapsible |
| `frontend/src/index.css` | `@import 'leaflet/dist/leaflet.css'` added |
| `frontend/package.json` | `leaflet` + `@types/leaflet` added |
| `CaseworkerPage.tsx` | `<RouteMap>` rendered above `<ItineraryView>` in routed state |

#### Returning Client Detection

| Change | Detail |
|--------|--------|
| `backend/main.py` | `returning_hint` computed from `find_similar()` result; threshold 0.35 |
| `CaseworkerPage.tsx` | Purple banner rendered if `routeResult.returning_hint` present; shows last_seen date, placed_at, outcome, match % |

#### Capacity Ticker

| Change | Detail |
|--------|--------|
| `backend/main.py` | `GET /api/v1/capacity`: computes `total_beds`, `available_beds`, `occupancy_pct` from live shelters dataset (no LLM) |
| `frontend/src/components/GatewayA/CapacityTicker.tsx` (new) | Polls `/capacity` every 60s; animated pulse dot; occupancy bar; color-coded by pressure |
| `CaseworkerPage.tsx` | `<CapacityTicker>` in header |

#### Speech Improvements

| Change | Detail |
|--------|--------|
| `useSpeech.ts` | `en-CA` → `en-IN` for STT (Google's dedicated Indian English model) |
| `useSpeech.ts` | TTS stays `en-US` (en-IN TTS voices not installed on most machines) |
| `useSpeech.ts` | `wantListeningRef` + auto-restart in `onend`: continuous mode survives Chrome termination/network blip |
| `useSpeech.ts` | `finalTextRef` accumulates confirmed-final segments; uses `e.resultIndex` to avoid re-processing |
| `useSpeech.ts` | `sr.onstart` sets `isListening=true` (not before `sr.start()`) — accurate UI state |
| `useSpeech.ts` | `getUserMedia` with `echoCancellation`, `noiseSuppression`, `autoGainControl` |
| `useSpeech.ts` | `voiceschanged` event caches TTS voices at module load (not per-call) |
| `frontend/src/config.ts` | `VOICE_SILENCE_KILL_MS`: 10,000 → 2,500 (2.5s natural pause) |
| `VoiceInput.tsx` | `en-CA` → `en-IN` |
| `KioskPage.tsx` | `startListening(false)` → `startListening(true)` (continuous mode) |

#### CaseworkerPage Identity Changes

| Change | Detail |
|--------|--------|
| `CaseworkerPage.tsx` | `caseworker_id` from `user?.email` (JWT via `useAuth()`); localStorage name input removed |
| `CaseworkerPage.tsx` | Header now shows caseworker name + Sign Out button |
| `CaseworkerPage.tsx` | `historyRefresh` incremented when `case_id` returned → `CaseworkerHistory` auto-reloads |

---

## 8. Known Remaining Issues

1. **Caseworker origin hardcoded** (`CaseworkerPage.tsx`)
   `originLat = 43.6532, originLon = -79.3832` (downtown Toronto). Fix: geolocation API or location picker similar to kiosk hub selector.

2. **Shelter sector mapping incomplete** (`solver.py:_apply_masks()`)
   Non-standard SECTOR values (e.g. "Couples") silently excluded. Fix: extend sector_map dict.

3. **GX10 NIM docker pull blocked by EULA**
   `nvcr.io/nim/google/gemma-3n-e4b-it:latest` → Access Denied on `docker compose up nim`. Fix: accept license at `https://build.nvidia.com/google/gemma-3n-e4b-it` then re-run `bash scripts/gx10-setup-models.sh`. Cloud NIM (Tier 1) works as substitute when `NGC_API_KEY` set.

4. **Frontend on :5173, not :3000**
   Demo URLs: `http://localhost:5173/caseworker` and `http://localhost:5173/kiosk`.
   Backend CORS defaults to `http://localhost:3000` — set `CORS_ORIGINS=http://localhost:5173` in `.env`.

5. **JWT_SECRET is insecure default**
   `"haven-matrix-dev-secret-change-in-prod"` hardcoded in `auth_store.py`. Set `JWT_SECRET=<random>` in `.env` before any real deployment.

6. **No email verification** (intentional for hackathon)
   Anyone can register. Acceptable for demo. Production needs: email verification, rate limiting on register endpoint.

7. **`parse_eligibility_answer()` not called by backend**
   Frontend owns this logic in `EligibilityFlow.tsx::parseAnswer()`. If patterns change, both must update.

8. **BenchmarkPanel fetch on unmount**
   Async fetch may try to set state on unmounted component. Fix: AbortController in cleanup.

9. **Respite/hygiene EDA entries have minimal metadata**
   The 1,584 EDA respite entries (places of worship + cooling centres) and 802 hygiene entries (fountains + washrooms) have `bypass_pathway=""`, `intake_preparation="Call ahead..."` defaults. Fine for KNN routing but caseworkers see sparse details. Enrich progressively if time permits.

10. **Frontend/backend config not auto-synced**
    `VOICE_SILENCE_KILL_MS` (2500) and other voice constants are manually mirrored between `frontend/src/config.ts` and `backend/config.py`.

---

## 9. Extension Guide

### Add a New Service Pillar

1. Add CSV to `data/` with lowercase columns: `lat`, `lon`, `organization_name`, `address`, `phone`, `hours`, `requires_id`, `harm_reduction`, `bypass_pathway`, `intake_preparation`
2. Add path constant in `config.py`
3. Add load line in `data_ingestion.py::load_all()`: `("new_pillar", NEW_CSV)`
4. Add `needs_new_pillar: bool = False` to `NeedsPayload` in `nim_compiler.py`
5. Add mask + pillar entry in `solver.py::_apply_masks()`
6. Update `NIM_TRIAGE_PROMPT` in `config.py` to include the new field
7. Update `_regex_fallback()` keywords
8. Frontend itinerary display picks up the new key automatically
9. Add a color for the new pillar in `RouteMap.tsx::PILLAR_COLORS`

### Change Solver Weights

Edit `config.py`: `WEIGHT_DISTANCE`, `WEIGHT_OCCUPANCY`, `WEIGHT_TRANSIT`. Run: `python backend/solver.py --benchmark`

### Add an Eligibility Question

1. Add pillar to `ASK_*_FOR_PILLARS` in `config.py`
2. Add question string in `voice_session.py::resolve_eligibility_questions()`
3. Add keyword parsing in `voice_session.py::parse_eligibility_answer()`
4. Mirror parsing in `EligibilityFlow.tsx::parseAnswer()`
5. Add field to `NeedsPayload` and its validator if needed

### Upgrade Case Store to ChromaDB

Replace `find_similar()` in `case_store.py`:
```python
import chromadb
from sentence_transformers import SentenceTransformer
# Initialize collection, embed transcripts, use collection.query() for similarity
# Keep the same return shape: list[dict] with 'similarity', 'placed_at', etc.
```

### Add Password Reset

1. Add `reset_tokens` table to `auth_store.py`
2. `POST /auth/forgot` → generate token, email user (needs SMTP config)
3. `POST /auth/reset` → verify token, update password hash

---

## 10. Testing Checklist

**Backend startup:**
```bash
# Verify datasets load
python backend/data_ingestion.py --verify --mode cpu
# Expected: 12,234 records, respite=1599, hygiene=817

# Start server
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Health check
curl http://localhost:8000/api/v1/health
# Expect: status:ok, rapids_mode:cpu, datasets includes respite/hygiene counts
```

**Auth:**
```bash
# Register
curl -s -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","name":"Test User","password":"test1234"}' | python3 -m json.tool
# Expect: {token: "eyJ...", user: {email, name, role: "caseworker"}}

# Login
curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"test1234"}' | python3 -m json.tool

# Me (replace TOKEN with actual JWT)
curl -s http://localhost:8000/api/v1/auth/me \
  -H "Authorization: Bearer TOKEN" | python3 -m json.tool

# Duplicate email → 409
# Wrong password → 401
```

**Routing + case store:**
```bash
curl -s -X POST http://localhost:8000/api/v1/caseworker/route \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"text":"male needs shelter no id been drinking","origin_lat":43.6532,"origin_lon":-79.3832}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('case_id:', d.get('case_id')); print('pillars:', list(d['itinerary'].keys()))"
# Expect: case_id is not null (if JWT provided), itinerary has shelter

# Check case saved
curl -s http://localhost:8000/api/v1/caseworker/test@test.com/history | python3 -m json.tool

# Update outcome
curl -s -X PATCH http://localhost:8000/api/v1/case/{case_id}/outcome \
  -H "Content-Type: application/json" \
  -d '{"outcome":"placed"}' | python3 -m json.tool
```

**Capacity ticker:**
```bash
curl -s http://localhost:8000/api/v1/capacity | python3 -m json.tool
# Expect: {total_beds, available_beds, occupied_beds, occupancy_pct}
```

**Returning client hint:**
```bash
# Route a case, mark it placed, then route a similar case
# Second route should return returning_hint with similarity >= 0.35
```

**Frontend:**
- [ ] `http://localhost:5173/caseworker` → redirects to `/login` (not authenticated)
- [ ] Register new account → lands on caseworker page with name in header
- [ ] CapacityTicker shows in header with animated pulse dot
- [ ] Route a client → RouteMap appears, click "Map View" to expand
- [ ] Route same client description again → purple returning client banner appears
- [ ] CaseworkerHistory panel shows the routed case, expand for detail, mark outcome
- [ ] Sign out → redirects to login page
- [ ] `http://localhost:5173/kiosk` → loads without login (public)

**PII + safety:**
- [ ] `POST /caseworker/route` with `"ignore previous instructions"` → HTTP 400
- [ ] `POST /caseworker/route` with phone number in text → PII redacted in logs
- [ ] `POST /caseworker/route` with crisis text → crisis response, no routing

---

## 11. GX10 Remote Access & GPU Model Setup

See `learning/gx10_access_and_gpu_guide.md` for full SSH/Tailscale instructions.

**Quick reference:**
- Tailscale IP: `100.81.85.39`
- SSH: `ssh chetankumar@100.81.85.39`
- NIM endpoint: `http://100.81.85.39:8001/v1`
- Set in `.env`: `NIM_ENDPOINT=http://100.81.85.39:8001/v1`

**EULA blocker:** `nvcr.io/nim/google/gemma-3n-e4b-it:latest` requires license acceptance at `https://build.nvidia.com/google/gemma-3n-e4b-it` before `docker pull` works.

**Workaround active:** `NGC_API_KEY` set in `.env` → cloud NIM (Tier 1) used. `compile_method: "nim"` works without GX10.

**On GX10 (inside RAPIDS container):**
```bash
docker run --gpus all --network host -v $(pwd):/app -w /app \
  -it rapidsai/base:25.06-cuda12-py3.12 bash
pip install -r backend/requirements.txt
python backend/data_ingestion.py --verify --mode gpu
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```
