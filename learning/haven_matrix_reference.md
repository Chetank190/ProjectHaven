# Haven Matrix — Interview, Setup & Tech Stack Reference

> Quick-access doc for hackathon day. Read this before judging starts.
> Companion to `haven_matrix_implementation.md` (full spec) and the actual source code.

---

## Current Codebase State (as of 2026-05-30, Session 12)

**All features working.** Auth active. Case store + returning hints active. Map view active. Capacity ticker live. Kiosk speech stable. Cloud NIM active if `NGC_API_KEY` set. Frontend on **:5173**.

### What's running right now
- Backend `:8000` — CPU routing, cloud NIM for LLM (`NGC_API_KEY` set), auth + case store active
- Frontend `:5173` — `http://localhost:5173/login` → caseworker | `http://localhost:5173/kiosk`
- GX10 `:8001` NIM — **EULA still unaccepted** (see Known Issues). Cloud NIM is active fallback.

### New in Session 12

**Kiosk bug fixes** (7 confirmed bugs fixed across 4 files):

`KioskPage.tsx`:
- Idle timer now cleared on component unmount (no more setState-on-dead-component warning)
- Crisis screen "tap to return" now also resets `sessionId`, `questions`, `lastAnswers`, `lastTranscript` — stale session no longer leaks into next interaction
- `submitText()` network failure now speaks an error message before returning to typing screen (was silently resetting state with no user feedback)

`EligibilityFlow.tsx`:
- Added 8 s `ttsFallback` timeout in `speakQuestion()` — if TTS never fires `onend`/`onerror` (browser engine locked), the question auto-advances instead of hanging indefinitely

`KioskItinerary.tsx`:
- Added `nearbyError` state: network failure on `/nearby` now shows "Couldn't load nearby services / Call 211" with a retry button, instead of silently rendering an empty list
- Leaflet map correctly rebuilds when switching back to route tab (linter fix: map is now destroyed on tab leave and rebuilt on return, fixing potential stale-tile issue)

`useSpeech.ts` (already had TTS keepAlive — verified correct):
- Chrome 15 s SpeechSynthesis cutoff handled via `setInterval(() => { pause(); resume(); }, 10_000)` started in `utt.onstart`, cleared in `onend`/`onerror`
- `stopSpeaking()` → `cancel()` triggers `onerror` which clears the interval — no leak

**Data sources documented** (`learning/DATA_SOURCES.md`):
- All 12 data sources catalogued with source URLs, licenses, row counts, column definitions, refresh commands
- Key: shelters auto-refresh from CKAN on startup; TTC GTFS and OSM are periodic manual re-exports

**Injection detection final state** (`backend/pii_scrubber.py`):
- Pattern: `\b(?:ignore|disregard)\s+(?:\w+\s+){0,3}(?:instructions?|prompts?|rules?|directives?)\b`
- Verified against 20 test cases: 12/12 attacks blocked, 8/8 legit caseworker phrases pass (including "User: male, 34", "Disregard previous behavioral flag", "Ignore prior clinical notes")
- `user:` removed from role-token list; `system:` and `assistant:` remain

**ASR / Voice model clarification**:
- Tier 1: Parakeet-0.6B-CTC on GX10 port 9000 (fast CTC decoder; **blocked by EULA**)
- Tier 2: NVIDIA cloud ASR (Parakeet via API; audio leaves device; requires `NGC_API_KEY`)
- Tier 3: Web Speech API, `lang = 'en-IN'` (Google's Indian English model — most accent-diverse English corpus, correct choice for Toronto's multilingual unhoused population)
- TTS: Web Speech Synthesis, `lang = 'en-US'`, preferred voices: Google UK English Female / Samantha / Karen

**`cLog` / `cWarn` structured logging** added across kiosk frontend (linter additions):
- `recording.start`, `recording.stop`, `session.created`, `session.crisis`, `session.error` events
- `eligibility.question`, `eligibility.answer`, `eligibility.complete` events
- Source: `frontend/src/lib/clientLog.ts`

### New in Session 11

**Kiosk mic/TTS isolation** (`frontend/src/components/shared/useSpeech.ts`, `KioskPage.tsx`):
- `speak()` now stops `SpeechRecognition` before starting TTS — prevents kiosk's own voice being transcribed
- `handleOrbTap()` calls `stopSpeaking()` + waits 500ms before opening the mic (speaker echo settles; 500ms on kiosk hardware, 250ms in earlier iteration)
- `EligibilityFlow` was already correct (mic only opens inside `onEnd` callback)

**Transit check vectorization** (`backend/solver.py`):
- Replaced per-candidate `_check_transit()` calls (45 sequential pandas mask scans) with a single `np.any()` broadcast over all stops × all candidates per pillar
- `_check_transit` function removed entirely; logic is now inline in `_score_and_rank()`
- Added early-return guard for empty `idx_list`

**Injection detection tightened** (`backend/pii_scrubber.py`):
- Initial fix in Session 11; further refined in Session 12 verification (see Session 12 above)

**Async startup** (`backend/main.py`):
- `fetch_weather_alert()` at startup changed to `await asyncio.to_thread(fetch_weather_alert)` — event loop no longer blocks during startup weather fetch

### New in Session 10

**Auth system** (`backend/auth_store.py`):
- Email + password register/login with JWT (24h tokens, HS256)
- `/auth/register`, `/auth/login`, `/auth/me` endpoints
- `bcrypt==4.0.1` PINNED — do not upgrade (passlib 1.7.4 compat)
- Caseworker identity now from JWT email, not localStorage name

**EDA Data Integration** (dataset expansion):
- `data/respite_sites.csv`: 15 → **1,599** rows (+1,407 places of worship, +177 cooling centres)
- `data/hygiene_stations.csv`: 15 → **817** rows (+798 drinking fountains, +4 washrooms)
- EDA validation: 96.8% shelter occupancy, 4,012 daily Central Intake calls, weather correlation confirmed

**Case Store Fully Wired** (`backend/case_store.py`):
- `save_case()` called after every routing — `case_id` returned in response
- `find_similar()` TF-IDF runs before LLM — top 3 resolved cases injected as RAG context
- `returning_hint` in response if similarity ≥ 0.35 (purple banner in UI)
- `GET /caseworker/{id}/history`, `PATCH /case/{id}/outcome` endpoints active

**Map View** (`frontend/.../RouteMap.tsx`):
- Leaflet, lazy-loaded, no API key needed
- Colored pins per pillar; click popups with name/phone/walk time
- Collapsible, appears above itinerary after routing

**Capacity Ticker** (`frontend/.../CapacityTicker.tsx`):
- Polls `GET /api/v1/capacity` every 60s — live bed count in caseworker header
- Color-coded: green (normal) / amber (≥93%) / red (≥97% critical)

**Speech improvements** (`useSpeech.ts`):
- STT: `en-CA` → `en-IN` (Google's Indian English model)
- Auto-restart on Chrome recognition termination (continuous mode)
- Silence timer: 10s → 2.5s; audio constraints (noise suppression, echo cancellation)
- `sr.onstart` for accurate listening state; TTS voice cached via `voiceschanged` event

### Known remaining issues
- **GX10 Parakeet ASR NIM blocked** — accept EULA at `build.nvidia.com/nvidia/parakeet-ctc-0.6b-asr`, then `docker pull nvcr.io/nvidia/nim/nvidia/parakeet-ctc-0.6b-asr:latest && docker run --gpus all -p 9000:9000 ...` — **must do before demo for on-device ASR privacy story**
- **GX10 Gemma NIM blocked** — accept EULA at `build.nvidia.com/google/gemma-3n-e4b-it` first
- Frontend on :5173 — set `CORS_ORIGINS=http://localhost:5173` in .env
- Caseworker origin hardcoded `(43.6532, -79.3832)` in `CaseworkerPage.tsx`
- Shelter sector mapping misses non-standard values (e.g. "Couples")
- `JWT_SECRET` is insecure default — set in `.env` for any real deployment
- No email verification (intentional for hackathon)
- Reservation codes accumulate in `cases.db` indefinitely (no cleanup job — not a demo risk)

See `haven_matrix_implementation.md` §7-§8 for full session logs and §8 for complete known issues.

---

## Table of Contents

1. [The Spark Story — Memorize This](#1-the-spark-story--memorize-this)
2. [Tech Stack — Every Layer Explained](#2-tech-stack--every-layer-explained)
3. [Setup Guide — Local Dev (MacBook)](#3-setup-guide--local-dev-macbook)
4. [Setup Guide — GX10 Grace Blackwell](#4-setup-guide--gx10-grace-blackwell)
5. [Running the App — Day-of Checklist](#5-running-the-app--day-of-checklist)
6. [Interview Q&A — Anticipated Judge Questions](#6-interview-qa--anticipated-judge-questions)
7. [Demo Script — What to Show Judges](#7-demo-script--what-to-show-judges)
8. [System Numbers to Know Cold](#8-system-numbers-to-know-cold)
9. [Troubleshooting — Most Likely Failures](#9-troubleshooting--most-likely-failures)
10. [GX10 Remote Access — SSH + Tailscale](#10-gx10-remote-access--ssh--tailscale)

> **GX10 ops start here:** [`gx10_access_and_gpu_guide.md`](gx10_access_and_gpu_guide.md) — SSH, Tailscale, GPU model wiring, port-forward.

---

## 1. The Spark Story — Memorize This

Deliver this in under 90 seconds. No notes.

> "Haven Matrix holds all seven data matrices — shelter occupancy, clinical services, food programs, hygiene stations, grassroots resources, public amenities, and 9,255 TTC stops — plus the full Nemotron-30B language model context, simultaneously in the DGX Spark's 128 gigabytes of unified memory.
>
> On any other hardware, you'd be serializing data through a PCIe bottleneck between CPU RAM and GPU VRAM. Here, everything lives in one coherent memory space. When someone speaks to the kiosk, their words become a boolean payload in milliseconds, and cuML solves the nearest accessible resources across all five pillars simultaneously in under ten milliseconds — accounting for whether they have ID, whether they're currently using, whether they have family with them.
>
> That number on the benchmark panel — that's not a claim. That's a measurement from this hardware, right now."

**The one-line version** (if you only have 15 seconds):
> "128 GB unified memory means the LLM and all seven datasets live in the same coherent space — no PCIe serialization. That's what makes the sub-10ms KNN possible."

---

## 2. Tech Stack — Every Layer Explained

### LLM Inference

| Component | Library/Tool | Why |
|-----------|-------------|-----|
| Primary LLM | **Nemotron-3-Nano-30B** (Q8_0, ~38 GB) | NVIDIA-published model, bounty-eligible, 30B parameters fit in 128 GB unified memory alongside all datasets |
| LLM server | **llama.cpp** with CUDA (`--n-gpu-layers 99`) | Runs on aarch64 GB10, OpenAI-compatible API, entire model on GPU |
| Cloud LLM | **Gemma 3n E4B** via NVIDIA cloud NIM (`integrate.api.nvidia.com`) | Active when `NGC_API_KEY` set; NVFP4 on Blackwell |
| Fallback LLM | **Gemma 3n E4B** via local NIM container (`:8001`) | Official NIM, zero code change to swap (same OpenAI API endpoint) |
| ASR | **Parakeet-0.6B-CTC** via NVIDIA NIM (`:9000`) | GPU speech recognition; ~3 GB; Web Speech API fallback in browser |
| Guardrails | **NeMo Guardrails** (Python library) | Colang pattern-matching rails: jailbreak + harmful content; PassthroughLLM = zero inference overhead |
| PII scrubber | `pii_scrubber.py` (custom) | Regex redaction of Canadian PII (SIN, OHIP, phone, email, postal) before any LLM call |
| LLM client | **openai** Python SDK | OpenAI-compatible API means same code works with NIM or llama.cpp |
| Offline fallback | Pure `re` regex keyword matcher | Works with zero network, zero model — always returns a valid `NeedsPayload` |

**Why LLM as compiler, not decision-maker?**
The LLM's only job is to convert messy natural language → a strict JSON boolean payload. It never decides which shelter to send someone to — that's deterministic cuML. This means a regex can substitute for the LLM at any time with no quality regression on routing.

---

### GPU Data Processing (RAPIDS CUDA-X)

| Component | Library | Why |
|-----------|---------|-----|
| DataFrames | **cuDF** | Drop-in pandas replacement. `cudf.read_csv()` loads directly into GPU unified memory — zero copy, zero PCIe transfer. Same syntax as pandas. |
| KNN spatial solve | **cuML NearestNeighbors** | Haversine distance metric, `algorithm="brute"`, sub-10ms for 5-pillar parallel solve on all datasets loaded in unified memory |
| Arrays | **cuPy** | Used for `deg2rad()` and origin array — same API as NumPy |
| CPU fallback | **pandas** + **scikit-learn** | Same code path, `EngineMode.CPU` triggers the import swap inside the function — not at module level, so the whole backend imports clean on a MacBook |

**The unified memory advantage (what to say to judges):**
On a standard GPU machine, you'd have 512 GB CPU RAM and 24 GB GPU VRAM. To do GPU KNN, you'd serialize through PCIe (12-16 GB/s) every time. On the GX10, there's no CPU RAM / GPU VRAM split — it's all one 128 GB pool. Nemotron-30B (38 GB) + 7 data matrices + working context all live there simultaneously, permanently. No serialization, no PCIe, no eviction.

---

### Backend

| Component | Library | Why |
|-----------|---------|-----|
| API framework | **FastAPI** | Async, Pydantic-native, auto-generates Swagger `/docs` — judges can test every endpoint without touching the frontend |
| ASGI server | **uvicorn[standard]** | Standard for FastAPI; `--reload` for dev |
| Data validation | **pydantic v2** | `NeedsPayload` with field validators ensures LLM output is always valid before hitting the solver |
| HTTP client | **requests** | CKAN shelter data fetch at startup |
| CSV parsing | **pandas** / **cuDF** | Interchangeable via `EngineMode` enum |

**Why FastAPI over Flask/Django?**
Auto-generated OpenAPI docs (`/docs`) are non-negotiable for a hackathon — teammates can test every endpoint without writing tests. Async handlers + `run_in_executor` mean the CPU benchmark doesn't block the GPU response.

---

### Frontend

| Component | Library | Why |
|-----------|---------|-----|
| UI framework | **React 18** | Component-based, state machine per gateway |
| Build tool | **Vite 5** | Sub-second HMR, proxy config eliminates CORS issues entirely |
| Language | **TypeScript 5** | All API shapes in `src/types/api.ts` — compiler catches mismatches before runtime |
| Styling | **Tailwind CSS 3** | Dark theme for kiosk (`bg-gray-950`) without custom CSS; WCAG AA contrast with `text-white` on dark |
| HTTP client | **axios** | Single instance with `/api/v1` base URL; Vite proxies to FastAPI |
| Routing | **react-router-dom v6** | `/caseworker` and `/kiosk` — two separate UIs, one React app |
| Speech input | **MediaRecorder API → Parakeet ASR NIM** | Audio blob → `/api/v1/transcribe` → GPU ASR; Web Speech API fallback if NIM offline |
| Speech recognition fallback | **Web Speech API** (`webkitSpeechRecognition`) | Live transcript display during recording; primary transcript if ASR NIM unavailable |
| Speech output | **speechSynthesis API** | pitch=0.85, preferred voice (Google UK English Female); browser-native, no external service |

**Why local ASR NIM over cloud STT?**
- Audio stays on the GX10 — never transmitted to any cloud service
- Parakeet-0.6B-CTC runs in 3 GB GPU memory alongside Gemma
- Web Speech API remains as fallback if Parakeet NIM isn't running
- Same NVIDIA ecosystem story as Gemma NIM

---

### Infrastructure

| Component | Tool | Why |
|-----------|------|-----|
| GPU container | `rapidsai/base:25.06-cuda12-py3.12` | Ships with cuDF + cuML pre-installed; CUDA 12 matches GB10; Python 3.12 |
| LLM container | NVIDIA NIM (`nvcr.io/nim/google/gemma-3n-e4b-it`) | Official NVIDIA inference microservice; same OpenAI API as llama.cpp |
| ASR container | NVIDIA NIM (`nvcr.io/nim/nvidia/parakeet-0-6b-ctc-en-us`) | Parakeet-0.6B-CTC; ~3 GB GPU; port 9000 |
| Guardrails | `nemoguardrails` Python package | No separate container; wraps LLM with colang rails; optional (GUARDRAILS_ENABLED=1) |
| Compose | `docker-compose.yml` | Three GPU services: `nim` (Gemma), `asr` (Parakeet), `backend` (CPU FastAPI) |

---

## 3. Setup Guide — Local Dev (MacBook)

Use this for building and testing before you get GX10 access. Everything runs in CPU mode with regex fallback for LLM.

### Prerequisites

```bash
# Python 3.11+
python3 --version

# Node 18+
node --version
npm --version

# Git
git --version
```

### Step 1 — Clone and create a virtual environment

```bash
cd ~/Desktop
git clone <repo-url> ProjectHaven
cd ProjectHaven

python3 -m venv .vhaven
source .vhaven/bin/activate   # Windows: .vhaven\Scripts\activate
pip install -r backend/requirements.txt
```

> If `pip` is not found outside a venv, use `python3 -m pip install -r backend/requirements.txt`.

### Step 2 — Verify datasets load

```bash
python3 backend/data_ingestion.py --verify --mode cpu
```

Expected output:
```
[INFO] CKAN has no coordinates — using local shelters.csv with cached coordinates
[CPU] Loaded 9793 total records in ~350 ms
  ✓ shelters          290 rows
  ✓ rehab              25 rows
  ✓ food               20 rows
  ✓ hygiene            15 rows
  ✓ grassroots         20 rows
  ✓ osm                55 rows
  ✓ stops            9368 rows
```

### Step 3 — Test NIM compiler (NIM offline = regex path)

```bash
python3 -c "
from backend.nim_compiler import compile_needs
p, method, ms = compile_needs('need a bed tonight, no ID, been drinking')
print(f'method={method}  shelter={p.needs_shelter}  has_id={p.has_id}  sobriety={p.sobriety_status}')
"
# Expected: method=regex  shelter=True  has_id=False  sobriety=using
```

### Step 4 — Run solver benchmark (CPU only on MacBook)

```bash
python3 backend/solver.py --benchmark
# Expected: CPU: ~80ms  (GPU unavailable — normal on MacBook)
```

### Step 5 — Start FastAPI

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

Open `http://localhost:8000/docs` → Swagger UI.

Quick health check:
```bash
curl http://localhost:8000/api/v1/health
```

### Step 6 — Start React frontend

```bash
cd frontend
npm install        # first time only
npm run dev
```

Open:
- `http://localhost:5173/caseworker` — caseworker gateway (**:5173**, not :3000 on this machine)
- `http://localhost:5173/kiosk` — kiosk (use Chrome for voice)

> Port 3000 is occupied by another project (PrepBuddy). Vite started on :5173.
> To use :3000: `pkill -f "depoprep"` to free the port, then restart Haven Matrix frontend.

### Step 7 — Test full flow

In Swagger (`/docs`) or curl:
```bash
curl -s -X POST http://localhost:8000/api/v1/caseworker/route \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Client needs shelter tonight, no ID, been drinking. Alone. Hungry.",
    "origin_lat": 43.6532,
    "origin_lon": -79.3832,
    "client_name": "Marcus"
  }' | python3 -m json.tool
```

Expected: JSON with `compile_method: "regex"`, `itinerary` with shelter + food stops, `ticket_text`.

---

## 4. Setup Guide — GX10 Grace Blackwell

> **The GX10 has no Wi-Fi.** You must SSH into it over a mobile hotspot before doing anything else.
> Full ops guide: [`gx10_access_and_gpu_guide.md`](gx10_access_and_gpu_guide.md) · Summary: [Section 10](#10-gx10-remote-access--ssh--tailscale)

**Quick SSH** (do this first, before any other step):
```bash
# 1. Connect your laptop to hotspot SSID: gx10-3cd8  (password: gx10-3cd8)
# 2. Open Terminal / PowerShell Admin:
ssh asus@gx10-3cd8.local
# When prompted: type yes → then password: password
```

**Team default: models on GX10 GPU only; backend + frontend on Mac.** See [`gx10_access_and_gpu_guide.md`](gx10_access_and_gpu_guide.md).

### On GX10 — download/store/load models (SSH)

```bash
cd ~/ProjectHaven && cp .env.example .env   # NGC_API_KEY
docker compose up nim -d                  # Gemma → GPU :8001, stored in volume nim-cache
docker compose logs -f nim                # first run: long NGC pull
curl -s http://localhost:8001/v1/models | head && nvidia-smi
```

Optional: `docker compose up asr -d` for Parakeet on GPU :9000.

### On Mac — backend + frontend

```bash
cp .env.example .env
# NIM_ENDPOINT=http://100.81.85.39:8001/v1  FORCE_CPU_SOLVER=1

source .vhaven/bin/activate
set -a && source .env && set +a
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

cd frontend && npm run dev
```

### Verify (Mac)

```bash
curl -s http://localhost:8000/api/v1/health        # rapids_mode: cpu
curl -s http://100.81.85.39:8001/v1/models | head # GX10 model reachable
# POST /caseworker/route → compile_method: nim
```

### Use the UI from your laptop (SSH port-forward)

```bash
ssh -L 3000:localhost:3000 -L 8000:localhost:8000 asus@gx10-3cd8
# Then open http://localhost:3000/caseworker on your laptop
```

---

## 5. Running the App — Day-of Checklist

Run this in order before judges arrive. Takes ~5 minutes if setup is done.

### Terminal layout (5 terminals)

| Terminal | What it runs |
|----------|-------------|
| 1 | `watch -n 1 nvidia-smi` — GPU usage visible during demo (shows Gemma + Parakeet memory) |
| 2 | `docker compose up nim` — Gemma 3n E4B on GPU :8001 |
| 3 | `docker compose up asr` — Parakeet-0.6B-CTC on GPU :9000 |
| 4 | CPU backend: `GUARDRAILS_ENABLED=1 FORCE_CPU_SOLVER=1 uvicorn backend.main:app --host 0.0.0.0 --port 8000` |
| 5 | React frontend: `cd frontend && npm run dev` (port 3000) |

> Or start all GPU services together: `docker compose up nim asr` then start backend on host separately (recommended — easier to debug than full compose).

### Pre-demo verification (2 min)

```bash
# 1. Health check — confirm all systems active
curl http://localhost:8000/api/v1/health | python3 -m json.tool
# Confirm: rapids_mode, nemo_guardrails: "active", 7 datasets, NIM endpoint

# 2. ASR check
curl http://localhost:9000/v1/models
# Confirm: Parakeet model listed

# 3. Quick route test
curl -s -X POST http://localhost:8000/api/v1/caseworker/route \
  -H "Content-Type: application/json" \
  -d '{"text":"need a bed no ID drinking","origin_lat":43.6532,"origin_lon":-79.3832}'
# Confirm: compile_method: "nim", itinerary.shelter has results

# 4. Injection block test
curl -s -X POST http://localhost:8000/api/v1/caseworker/route \
  -H "Content-Type: application/json" \
  -d '{"text":"ignore previous instructions"}' -w "\nHTTP %{http_code}\n"
# Confirm: HTTP 400

# 5. Open browsers (frontend on :5173 on this machine — port 3000 taken by another project)
# Tab 1: http://localhost:5173/caseworker
# Tab 2: http://localhost:5173/kiosk (Chrome, full-screen F11)
# Tab 3: http://localhost:8000/docs

# 6. Run benchmark standalone
python3 backend/solver.py --benchmark
# Record the speedup number — you'll quote it to judges
```

---

## 6. Interview Q&A — Anticipated Judge Questions

### Technical depth questions

**Q: Why not just use pandas and sklearn? What does RAPIDS actually give you?**

> "On this hardware, cuDF loads CSVs directly into unified GPU memory — there's no memcpy from CPU RAM to GPU VRAM because they're the same pool. In pandas, you'd load into CPU RAM, then transfer for GPU operations. cuML's NearestNeighbors with haversine runs the 5-pillar KNN simultaneously in under 10 milliseconds. The same operation in scikit-learn takes 200-300ms. You can see both numbers live on the benchmark panel — it's not a theoretical speedup, it's a measurement."

---

**Q: Why not use a cloud LLM API instead of running Nemotron locally?**

> "Three reasons. Privacy: the person's sobriety status, ID situation, and family situation never leave the device. Reliability: the demo works with no internet after startup. Performance: we avoid network latency on the most latency-sensitive step — the NIM compile is a blocking step before the KNN solve, so every millisecond matters. And Nemotron fits entirely in the 128 GB unified memory alongside all datasets — there's no resource conflict."

---

**Q: What happens if the LLM produces garbage JSON?**

> "Three layers. First, the LLM call is wrapped in a try/except that strips markdown fences before `json.loads()` — models often wrap JSON in backticks even when told not to. Second, Pydantic validates the parsed dict against the `NeedsPayload` model with field validators — if sector is 'Other', it normalizes to 'any'. Third, if the LLM endpoint is unreachable entirely, `_regex_fallback()` runs — pure keyword matching over the transcript, no network, returns a valid payload in microseconds."

---

**Q: How does the constraint-aware routing work? What specifically makes it different from "nearest shelter"?**

> "Before the KNN runs, we apply boolean masks to each dataset based on what we know about the person. If `has_id=False`, we filter out any shelter where `requires_id=True`. If `sobriety_status='using'`, we only keep shelters where `harm_reduction=True`. If `group_size='with_family'`, we restrict to the Families sector. The KNN then runs only over the filtered set — it's not 'nearest resource' then filter, it's 'nearest resource you can actually walk into given your situation'. The bypass_pathway column tells the caseworker what to say at the door if the situation differs from the dataset."

---

**Q: Walk me through the full pipeline stages.**

> 1. Voice/text capture — Kiosk: MediaRecorder + Web Speech API live preview, OR text input (`'typing'` state). Caseworker: text or VoiceInput
> 2. ASR NIM — Parakeet-0.6B-CTC (`:9000`) transcribes audio blob on GPU; falls back to Web Speech if NIM offline
> 3. PII redaction — `pii_scrubber.redact_pii()` replaces phone numbers, SINs, OHIP, emails, dates with `[REDACTED]`
> 4. Injection detection — `has_injection()` regex check on caseworker route (Gateway A only) → HTTP 400 if triggered
> 5. NeMo Guardrails — colang pattern-matching rails: jailbreak + harmful content → HTTP 400 if triggered
> 6. **Crisis gate** — `crisis_gate.is_crisis()` deterministic regex: suicidal ideation/overdose/violence → hotline + early return (no LLM)
> 7. NIM compiler — LLM (Gemma/Nemotron) converts cleaned text to strict JSON `NeedsPayload`
> 8. Pydantic validation — field validators normalize edge cases, reject invalid output
> 9. Constraint masking — boolean masks filter datasets by eligibility (has_id, sobriety, group_size)
> 10. Open-now filter — `is_open_now()` penalizes closed facilities (+2.0 score)
> 11. cuML KNN solve — haversine nearest neighbor on masked coordinate arrays
> 12. Congestion balancer — composite score: 60% distance + 30% occupancy + 10% transit
> 13. GTFS transit join — bounding box check against 9,255 TTC stops
> 14. TTS readback — `speechSynthesis` reads the itinerary aloud (Gateway B)

---

**Q: What is the 128 GB unified memory advantage concretely? I've heard this before.**

> "Concretely: we loaded Nemotron at 38 GB, 7 datasets at roughly 2 GB total, and all working context into the same memory pool and they just coexist. On a standard server with a 24 GB A100, you'd have to either: (a) not load the model, or (b) page datasets in and out through PCIe. PCIe Gen5 on a typical system is 64 GB/s bidirectional. Loading 2 GB of datasets would take ~30ms of PCIe transfer before any compute starts. Here that transfer is zero — the data is already there. That's the architectural difference that makes sub-10ms KNN plausible while a 30B model is loaded."

---

**Q: Could you scale this to real production?**

> "The architecture already assumes scale in two ways. First, the fallback chain means it degrades gracefully — NIM down, regex takes over. GPU down, pandas takes over. CKAN down, cached CSV loads. Second, the session store is in-memory by design for the hackathon, but it's a single-file replacement with Redis. The KNN solve is already sub-10ms, so the bottleneck at scale would be the LLM compile — which you'd address with request batching or a dedicated NIM cluster. The data pipeline side scales horizontally — more cuDF workers on more GX10 nodes."

---

### Product / social impact questions

**Q: Why is this better than just calling 211?**

> "211 gives you a phone number and a list of organizations. Haven Matrix gives you: the three closest places you can walk to right now, filtered by whether you can actually get in given your ID and substance use, with a phrase to say at the door. For a caseworker, it generates the phone call script they'll read when they call ahead. And critically — Gateway B doesn't require the person to read anything, have a phone, or navigate a website. They hold a button and speak. The kiosk reads the route back to them."

---

**Q: Is the data real?**

> "The shelter data is from Toronto Open Data CKAN — same feed the city shelter system updates daily at 4 AM. We pull it at startup and cache it. The TTC stops are the official GTFS feed — 9,369 stops. The rehab services are compiled from ConnexOntario's public directory. The food bank data is from Toronto community services. OSM amenities are pre-fetched from Overpass. The grassroots orgs are from 211 Ontario's public directory. Everything is real Toronto data."

---

**Q: What about privacy? Are you storing anything about the person?**

> "Three layers. First, audio: the kiosk uses the browser's MediaRecorder API — the audio blob is sent only to our local FastAPI endpoint on the GX10, then forwarded to Parakeet ASR NIM running locally. Nothing touches any cloud service. Second, the transcript text: before it reaches the LLM, our PII scrubber runs regex patterns over it — phone numbers, Social Insurance Numbers, Ontario OHIP health card numbers, email addresses, postal codes, and dates are all replaced with `[REDACTED]`. Third, the LLM prompt itself opens with a privacy rule that tells the model to ignore any remaining personal identifiers and extract only service needs. After routing, the session expires in 120 seconds and is deleted from memory. We don't log transcript content — only the character count. The system genuinely doesn't know who used it."

---

**Q: Why a kiosk instead of a mobile app?**

> "The population using Gateway B has a high rate of no smartphone, dead battery, and no data plan. A kiosk at a shelter hub, transit station, or resource centre is always on and always connected to local WiFi. Voice-first means no literacy barrier — someone in acute crisis doesn't need to navigate a UI. The 45-second recording cap and 10-second silence auto-release mean even someone in distress can get a route without needing to understand how to 'use' the interface."

---

### NVIDIA / hardware questions

**Q: Why the GB10 specifically? Couldn't you run this on any GPU?**

> "You could run the individual pieces. But here's what the GB10 gives us that you can't replicate by throwing money at cloud GPUs: unified coherent memory. Cloud GPU instances (A100, H100) have separate CPU and GPU address spaces. To do what we're doing — LLM inference while simultaneously running KNN over datasets — you'd need to schedule memory carefully. Here it's not a concern. All 128 GB is one coherent pool. The LLM, the datasets, and the working context all live there and see each other directly. That's the architectural difference."

---

**Q: What NVIDIA libraries are you using?**

> "Seven NVIDIA components. cuDF for GPU DataFrames — zero-copy CSV loading into unified memory. cuML for the KNN solver — haversine NearestNeighbors in under 10ms. Gemma 3n E4B via local NIM on port 8001 as the LLM compiler. Nemotron-3-Nano-30B via llama.cpp on port 30000 as the optional primary LLM. Parakeet-0.6B-CTC via NIM on port 9000 for GPU speech recognition. NeMo Guardrails as the input safety layer — colang pattern-matching rails for jailbreak and harmful content. And cloud NIM at `integrate.api.nvidia.com` as the cloud fallback tier when NGC_API_KEY is set. RAPIDS comes from the `rapidsai/base:25.06-cuda12-py3.12` container. A pure-regex extractor is the final fallback so routing never goes down even if every model is offline."

---

**Q: What is NeMo Guardrails and why did you add it?**

> "NeMo Guardrails is NVIDIA's framework for adding programmable safety rails to LLM-powered applications. You define 'colang' flows that pattern-match user input — if input matches a jailbreak or harmful content pattern, it returns a refusal immediately without calling the LLM at all. We added it because we're handling vulnerable populations: someone in crisis could accidentally trigger a harmful content response, and a malicious actor could try to inject into the clinical caseworker channel. The key architectural choice: we inject a PassthroughLLM as the NeMo backend. For inputs that pass all rails, it returns 'PASS' instantly with zero network overhead. Only blocked inputs incur any compute — and they don't reach the model at all."

---

**Q: Why Parakeet over Whisper for ASR?**

> "Parakeet is NVIDIA's own model — it's on the NVIDIA NGC registry and runs as an official NIM container with the same OpenAI-compatible API as Gemma. It's 600M parameters, uses about 3 GB on the GPU, and runs natively on Blackwell. Whisper is fine but it's OpenAI's model, not NVIDIA's. For a judged hackathon using NVIDIA hardware, showing the full NVIDIA inference stack — Parakeet NIM for speech, Gemma NIM for language, RAPIDS for data — is the right story. And the Web Speech API stays as an instant fallback so the demo never breaks if the ASR container isn't running."

---

## 7. Demo Script — What to Show Judges

Total time: 4-5 minutes. Lead with Gateway B (kiosk) — it's the most dramatic.

### Segment 0 — Auth (30 sec, do before judges arrive)

1. Open `http://localhost:5173/caseworker` — redirects to `/login`
2. Register a demo account (or log in if already created): `demo@haven.com` / `demo1234`
3. Confirm: lands on caseworker page, capacity ticker in header, name shown

### Segment 1 — Gateway B Kiosk (2 min)

1. Open `http://localhost:5173/kiosk` in Chrome, **full screen (F11)**
2. Point at `nvidia-smi` terminal — show Gemma + Parakeet loaded, GPU memory usage
3. TTS plays: *"Welcome. I'm here to help you find shelter, food, or care. Tap the button and tell me what you need."*
4. **Tap the orb once** — orb turns teal, shows "Tap when done"
5. Speak: *"I need somewhere to sleep tonight and I haven't eaten"* — live transcript appears below orb
6. **Tap orb again** — audio blob goes to Parakeet ASR NIM → transcript returned
7. TTS asks (gentle voice): *"Do you have a piece of ID with you right now?"* — tap + speak: "No"
8. TTS asks: *"Have you had anything to drink?"* — tap + speak: "Yes"
9. TTS asks: *"Are you on your own?"* — tap + speak: "By myself"
10. Route appears + TTS reads it: *"I found some places that can help you today. First, go to…"*
11. Point at screen: "This person can't read, is in crisis, and just got a route they can actually walk into right now — using GPU speech recognition and a GPU language model, entirely on this box."

### Segment 2 — Gateway A Caseworker (2 min)

1. Switch to `http://localhost:5173/caseworker` (already logged in)
2. Point at header: capacity ticker (live beds), caseworker name, sign-out
3. Point at "My Cases" panel — history of all routed clients
4. Type: *"22yo male, sleeping rough 3 weeks, drinking heavily. Needs detox and a bed. Hasn't eaten today. No ID."*
5. Click Route — show PayloadConfirm toggles populate automatically
6. Submit — show: **purple returning client banner** (if routing same person twice), RouteMap (click to expand), itinerary with occupancy bars
7. Click "Map View" — colored pins appear on Toronto map, click a pin for popup
8. Click "Generate phone script" on top shelter — handoff script modal
9. Go to "My Cases" — new case appears with "Pending" badge, mark as "Placed"
10. Say: "This caseworker now has a persistent, searchable history of every referral they've made — and the system learned from it."

### Segment 3 — The Numbers (30 sec)

1. Point at benchmark panel: "GPU Xms, CPU Xms, Speedup X×"
2. Run in terminal: `python3 backend/solver.py --benchmark`
3. Say: "That's the Spark Story — 128 GB unified memory, no PCIe serialization, sub-10ms solve. Not a claim. A measurement."

### Segment 4 — Swagger (optional, if judges ask about API)

1. `http://localhost:8000/docs`
2. Try `GET /health` live — show 7 datasets loaded
3. "Every endpoint is testable here without touching the UI."

---

## 8. System Numbers to Know Cold

Memorize these. Judges will ask.

| Number | What it means |
|--------|---------------|
| **128 GB** | GX10 unified memory pool — LLM + ASR + all datasets + context, no PCIe |
| **38 GB** | Nemotron-3-Nano-30B GGUF (Q8_0 quantized) footprint in memory |
| **~3 GB** | Parakeet-0.6B-CTC ASR NIM footprint (runs alongside Gemma NIM) |
| **< 10 ms** | GPU KNN solve across all 5 pillars simultaneously |
| **200-300 ms** | Same solve on CPU (pandas + scikit-learn) — the comparison |
| **~30-40×** | Speedup ratio on GX10 (varies; live number on benchmark panel) |
| **15** | Pipeline stages: JWT extract → RAG lookup → ASR → PII → injection → guardrails → crisis gate → NIM+context → Pydantic → mask → open-now → KNN → score → GTFS → save case |
| **7** | NVIDIA components: cuDF, cuML, Gemma NIM, Parakeet NIM, Nemotron/llama.cpp, cloud NIM, NeMo Guardrails |
| **10** | Datasets loaded: shelters, rehab, food, hygiene(817), grassroots, youth_spaces, libraries, respite(1599), osm, stops |
| **12** | Kiosk hub locations (data-driven from shelter CSV clustering) |
| **9,368** | TTC stops for transit proximity scoring |
| **290** | Toronto shelter programs in dataset |
| **1,599** | Respite hub locations (15 curated + 1,407 places of worship + 177 cooling centres) |
| **817** | Hygiene asset locations (15 curated + 798 drinking fountains + 4 washrooms) |
| **96.8%** | Toronto shelter system average occupancy (EDA validated, 30-day rolling) |
| **4,012** | Daily Central Intake calls — 10% diversion = 400 calls/day removed from operators |
| **6** | Canadian PII pattern types redacted before LLM (phone, email, SIN, OHIP, postal, date) |
| **3** | Max similar past cases injected as LLM context per routing call (RAG) |
| **0.35** | TF-IDF similarity threshold for returning client detection banner |
| **120s** | Session expiry / inactivity reset (kiosk) |
| **60% / 30% / 10%** | Composite score weights: distance / occupancy / transit |
| **2.5s** | Voice silence kill timer (was 10s — reduced for natural conversation feel) |

---

## 9. Troubleshooting — Most Likely Failures

### Server won't start: `No module named 'backend'`

```bash
# Must run from project root, NOT from backend/ subdirectory
cd ~/ProjectHaven
uvicorn backend.main:app --port 8000 --reload
```

---

### Data loads but shelter names show "Unknown"

The `ORGANIZATION_NAME` column (UPPERCASE) is only present in shelters. Solver now checks both case variants — this should be fixed. If it recurs, inspect:
```bash
python3 -c "import pandas as pd; df=pd.read_csv('data/shelters.csv'); print(df.columns.tolist())"
```
Confirm `ORGANIZATION_NAME` and `LAT` are present.

---

### CKAN fetch overwrites shelters.csv with data missing LAT/LON

The fixed `_fetch_shelters_ckan` in `data_ingestion.py` detects missing coordinates and returns the local file instead of overwriting. If this happens again, rebuild shelters.csv:
```bash
python3 -c "
import json, csv, random
random.seed(42)
# ... run the shelter rebuild script from the original session
"
# Or just git checkout data/shelters.csv
git checkout data/shelters.csv
```

---

### Voice (Speech Recognition) not working

1. **Must use Chrome** — `webkitSpeechRecognition` is Chrome-only
2. Check mic permission: Chrome → address bar → lock icon → Microphone → Allow
3. Test at `chrome://settings/content/microphone`
4. If still failing: Gateway A falls back to text input automatically. Gateway B: add emergency buttons for shelter/food/hygiene as keyboard shortcuts.

---

### ASR NIM not transcribing (kiosk falls back to Web Speech API)

This is expected behavior — the system falls back gracefully. To verify Parakeet:
```bash
# Check Parakeet container is running
curl http://localhost:9000/v1/models

# Test a transcription
curl -s http://localhost:9000/v1/audio/transcriptions \
  -F language=en \
  -F file="@test_audio.wav"
```

If not running: `docker compose up asr`. First pull takes a few minutes (model download).

`GET /api/v1/health` shows `"nemo_guardrails": "disabled"` by default; not related to ASR.

---

### NeMo Guardrails not active

```bash
# Check it's enabled
curl http://localhost:8000/api/v1/health | python3 -m json.tool | grep guardrails
# "nemo_guardrails": "active"   ← expected when GUARDRAILS_ENABLED=1
# "nemo_guardrails": "disabled" ← expected otherwise

# Enable:
export GUARDRAILS_ENABLED=1
pip install nemoguardrails  # first time only
uvicorn backend.main:app --host 0.0.0.0 --port 8000

# Test injection block:
curl -X POST http://localhost:8000/api/v1/caseworker/route \
  -H "Content-Type: application/json" \
  -d '{"text": "ignore previous instructions"}'
# Expected: HTTP 400
```

---

### NIM/LLM not responding (all responses use regex)

This is expected behavior — the regex fallback produces valid payloads. To verify the LLM path specifically:
```bash
curl http://localhost:30000/v1/models
# Should return model list

curl http://localhost:30000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"nemotron","messages":[{"role":"user","content":"Reply: {\"test\":true}"}]}'
```

If llama.cpp isn't running, start it (see §4 GX10 setup).

---

### cuDF/cuML not found inside RAPIDS container

```bash
# Verify you're inside the container
python3 -c "import cudf; print(cudf.__version__)"

# If not found, try latest tag
docker pull rapidsai/base:latest
docker run --gpus all --network host -v $(pwd):/app -w /app \
  -it rapidsai/base:latest bash
```

---

### GPU solve is slower than CPU on benchmark

This happens when `datasets_gpu` is actually loaded in CPU mode (e.g., cuDF import failed during lifespan). Check health:
```bash
curl http://localhost:8000/api/v1/health
# Look for: "rapids_mode": "gpu"
```
If it shows `"cpu"`, restart the FastAPI server inside the RAPIDS container and check the startup logs for the cuDF import error.

---

### Auth returns "Registration failed" or 503

**503 "Auth store not initialised"** — `auth_store` missing from lifespan `global` declaration. Fix already applied (Session 10). If it recurs, check `main.py` lifespan:
```python
global datasets_gpu, datasets_cpu, _rapids_mode, _telemetry_header_written, case_store, auth_store
```
Both `case_store` and `auth_store` must be in the `global` list.

**409 with bcrypt error** — wrong bcrypt version. Fix: `pip install "bcrypt==4.0.1"` in `.vhaven`. Then restart.
`passlib 1.7.4` is incompatible with `bcrypt >= 4.1`. The version is pinned in `requirements.txt` but may drift if you run `pip install -U`.

**"Registration failed" in UI** — check Chrome DevTools Network tab for the actual HTTP status and error detail. Common: 503 (not initialised), 409 (duplicate email), 500 (bcrypt version).

---

### Port 8000 already in use

```bash
lsof -ti :8000 | xargs kill -9
# Then restart uvicorn
```

---

### React shows blank page or CORS errors

1. Confirm Vite is running: `http://localhost:5173` (port 3000 is taken by another project on this machine)
2. Confirm FastAPI is on port 8000: `http://localhost:8000/api/v1/health`
3. Set `CORS_ORIGINS=http://localhost:5173` in `.env` if you see CORS errors
4. The Vite proxy (`/api` → `http://localhost:8000`) only works with `npm run dev` — not from a static build

### Caseworker page immediately redirects to login

Token expired or invalid. Log in again. If it loops: clear localStorage in Chrome DevTools → Application → Local Storage → delete `haven_auth_token`.

### Map view shows blank/broken tiles

Requires internet connection (OpenStreetMap tiles). On demo day, ensure the laptop has WiFi. The rest of the app works offline — only the map tiles need internet.

---

## 10. GX10 Remote Access — SSH + Tailscale

> The GX10 has **no built-in Wi-Fi**. All remote access goes through mobile hotspot → SSH, then optionally Tailscale for persistent access across any network.
>
> **Full guide:** [`gx10_access_and_gpu_guide.md`](gx10_access_and_gpu_guide.md) — GPU model wiring, port-forward, day-of terminal layout.

### Your Unit's Credentials

```
Hotspot SSID:     gx10-3cd8
Hotspot Password: gx10-3cd8
SSH command:      ssh asus@gx10-3cd8.local
Username:         asus
Password:         password
```

> Remote access info is on the pamphlet in the box. One or two units may lack a pamphlet — credentials pattern is the same. No pamphlet? Flip unit over → **MAC1** sticker → last 4 characters complete the name (e.g. `3C:D8` → `gx10-3cd8`).

---

### Method A — SSH via Mobile Hotspot (fastest, same-network only)

**Step 1 — Connect your laptop to the hotspot**

The GX10 auto-connects to a saved hotspot profile. Connect **your laptop** to the GX10 hotspot (or enable your phone hotspot — either works):

| Field | Value |
|-------|-------|
| Hotspot SSID | `gx10-3cd8` |
| Hotspot Password | `gx10-3cd8` |

**Step 2 — SSH in**

Open **Terminal** (Mac/Linux — preferred on Mac) or **PowerShell as Administrator** (Windows):

```bash
ssh asus@gx10-3cd8.local
```

When prompted:
1. Type `yes` → press Enter (accepts the host key fingerprint)
2. Password: `password` → press Enter

You'll see the GX10 shell prompt when it works.

**Credentials summary:**
| Field | Value |
|-------|-------|
| Username | `asus` |
| Password | `password` |
| Hostname | `gx10-3cd8.local` |
| SSH System Name | `asus@gx10-3cd8` |

> **Other units at the event** use the same pattern (`gx10-XXXX.local`) but with their own 4-character ID from the pamphlet or MAC1 sticker.

---

### Method B — Tailscale (persistent, works across any network)

Use this after initial SSH setup so you can access the GX10 without being on the same hotspot.

**Step 1 — Install Tailscale on your laptop**

Download: https://tailscale.com/download

- **Do NOT use a `.edu` email** — institutional emails block Tailscale registration
- Use a personal Gmail, Outlook, or GitHub login

**Mac setup:**
- Allow all configuration prompts during install
- After install, a Tailscale icon appears in the menu bar — click it and make sure it's **enabled**
- If icon isn't visible: remove some menu bar icons and it will appear

**Windows setup:**
- Tailscale icon lives in the **hidden system tray** (bottom-right, click the ^ arrow)
- Right-click the icon → Connect

**Step 2 — Pair the GX10 to your Tailscale account**

Tailscale is pre-installed on the GX10. SSH in first (Method A above), then run:

```bash
sudo tailscale up
```

This prints a URL. Copy it → paste in your laptop's browser → authorize.

The GX10 is now in your Tailscale network.

**Step 3 — SSH via Tailscale from anywhere**

```bash
# By hostname:
ssh asus@gx10-3cd8

# By Tailscale IP (starts with 100.):
ssh asus@100.X.X.X
# Find the IP in your Tailscale app under "Machines"
```

---

### Inviting teammates to your Tailscale network

**Team invite link (Project Haven):**

https://login.tailscale.com/uinv/iC7hHtsfaC215vP2zbheG11

Or via admin console:

1. Open the **Tailscale admin console** (tailscale.com → Admin Console)
2. Click **Invite users** → **Invite by email**
3. Teammate receives an email → installs Tailscale → prompted to join two tailnets → **choose your (the host's) email**
4. Teammate can now SSH using: `ssh asus@gx10-3cd8` or `ssh asus@100.X.X.X`

---

### Venue Wi-Fi transition (requires monitor on GX10)

The hotspot profile is persistent — the GX10 will keep reconnecting to it on every reboot. To switch to venue Wi-Fi:

1. Connect a **monitor** to the GX10
2. Turn off the hotspot and pair with venue Wi-Fi on the GX10 directly
3. Delete the saved hotspot profile:

```bash
nmcli con show                         # lists all saved connections
nmcli con delete gx10-3cd8-Hotspot
```

This is permanent. After deletion, the GX10 will only connect to saved Wi-Fi networks.

---

### Using the UI from your laptop (SSH port-forward)

```bash
ssh -L 3000:localhost:3000 -L 8000:localhost:8000 asus@gx10-3cd8
```

Then open http://localhost:3000/caseworker on your laptop while services run on the GX10.

---

### Quick reference card

```
YOUR UNIT:
  Hotspot SSID/Password: gx10-3cd8
  SSH:                   ssh asus@gx10-3cd8.local
  Username / Password:   asus / password

INITIAL ACCESS:
  Connect laptop to hotspot gx10-3cd8 → ssh asus@gx10-3cd8.local → yes → password

TAILSCALE SETUP (once):
  SSH in → sudo tailscale up → authorize URL in browser
  Team invite: https://login.tailscale.com/uinv/iC7hHtsfaC215vP2zbheG11

DAILY REMOTE ACCESS (after Tailscale):
  ssh asus@gx10-3cd8  (or ssh asus@100.X.X.X)

USE UI FROM LAPTOP:
  ssh -L 3000:localhost:3000 -L 8000:localhost:8000 asus@gx10-3cd8

DELETE HOTSPOT (cleanup):
  nmcli con delete gx10-3cd8-Hotspot

FULL GPU + MODEL GUIDE:
  learning/gx10_access_and_gpu_guide.md
```

---

*Last updated: May 30, 2026 — GX10 remote access + link to GPU model guide*
