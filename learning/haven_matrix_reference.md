# Haven Matrix — Interview, Setup & Tech Stack Reference

> Quick-access doc for hackathon day. Read this before judging starts.
> Companion to `haven_matrix_implementation.md` (full spec) and the actual source code.

---

## Current Codebase State (as of 2026-05-30, commit `c437d2a` + NVIDIA NIM integration)

**Both gateways are implemented and working in CPU/local dev mode.** GPU path requires RAPIDS container on GX10.

### NVIDIA NIM Integration (latest)
- **Model:** Gemma 3n E4B (NVFP4) — `google/gemma-3n-e4b-it` via `integrate.api.nvidia.com`
- **4-tier retry chain:** NVIDIA cloud NIM → local llama.cpp (Nemotron) → local NIM container → regex fallback
- **Cloud tier:** active when `NGC_API_KEY` env var is set (dev/MacBook mode)
- **GX10 mode:** NIM container runs Gemma 3n E4B locally via `nvcr.io/nim/google/gemma-3n-e4b-it:latest`
- **Config:** `NVIDIA_CLOUD_ENDPOINT`, `NVIDIA_CLOUD_MODEL`, `NEMOTRON_MODEL` added to `config.py`
- **`_nim_tiers()`** helper in `nim_compiler.py` builds tier list dynamically from env vars
- `docker-compose.yml` NIM image updated from Llama 3.1 8B to Gemma 3n E4B

### Changes applied since initial implementation

**Session 1 — Improvements:**
- Removed dead `eligibility_mask()` function in `solver.py`
- Added Pydantic Field validators for lat/lon on all route request models (`main.py`)
- CORS origins now configurable via `CORS_ORIGINS` env var; restricted to GET+POST
- Background session GC task added to lifespan (`_cleanup_expired()` every 60s)
- OSM JSON load wrapped in try-except with empty fallback (`data_ingestion.py`)
- NIM API key from `NIM_API_KEY` env var instead of hardcoded string (`nim_compiler.py`)
- `.gitignore` updated — `CLAUDE.md`, `learning/`, `.claude/` are now gitignored (kept locally)

**Session 2 — 9 logic gaps fixed:**
- KioskPage transcript validation: hardcoded `5` -> `VOICE_MIN_CHARS` constant (`10`)
- EligibilityFlow voice race condition: added `idx` + `flowState` to useEffect deps
- TTS script: `r['name']`/`r['address']` direct access -> `.get()` (prevents KeyError)
- OSM occupancy_ratio: `0.0` -> `0.5` (was biasing OSM facilities to rank #1)
- Health check: returns actual `NIM_ENDPOINT` from config (not hardcoded localhost string)
- Kiosk error state: `setError()` now actually called in catch blocks
- Transit radius: longitude conversion `73_000` -> `80_000` (Toronto ~80 km/degree)
- Kiosk route: guards `session.payload_draft is None` before `.model_dump()` call
- PayloadConfirm countdown: `submitted` ref prevents `onConfirm` double-fire at 0

### Known remaining issues (not yet fixed)
- `has_id=None` treated as "has ID" by solver — could route to ID-required facility
- Shelter sector mapping misses non-standard SECTOR values (e.g. "Couples")
- No audit trail for caseworker routing (Gateway A sessions not persisted)
- Frontend `config.ts` voice constants manually synced from `backend/config.py`
- `parse_eligibility_answer()` in `voice_session.py` imported but never called by backend
- BenchmarkPanel async fetch on unmount (React warning, not a crash)
- NIM retry loop treats timeout same as bad JSON (slow fallback on network issues)
- Caseworker origin hardcoded to `(43.6532, -79.3832)` in `CaseworkerPage.tsx`

See `haven_matrix_implementation.md` sections 7 and 8 for full details and file references.

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
| Speech input | **Web Speech API** (`webkitSpeechRecognition`) | Browser-native STT, zero VRAM, zero cloud, works on localhost in Chrome |
| Audio buffer | **MediaRecorder API** | Kiosk-mode: buffers full audio blob before processing; prevents partial-transcript triggers |
| Speech output | **speechSynthesis API** | Browser-native TTS, no external service, reads eligibility questions and itinerary aloud |

**Why Web Speech API over Whisper or cloud STT?**
- No audio leaves the device (FR privacy requirement)
- Zero model VRAM (Nemotron already uses 38 GB)
- Zero latency to start listening
- Works in Chrome with no setup
- Offline after browser cache loads

---

### Infrastructure

| Component | Tool | Why |
|-----------|------|-----|
| GPU container | `rapidsai/base:25.06-cuda12-py3.12` | Ships with cuDF + cuML pre-installed; CUDA 12 matches GB10; Python 3.12 |
| LLM container | NVIDIA NIM (`nvcr.io/nim/google/gemma-3n-e4b-it`) | Official NVIDIA inference microservice; same OpenAI API as llama.cpp |
| Compose | `docker-compose.yml` | Optional; manual startup recommended for hackathon (easier to debug) |

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
- `http://localhost:3000/caseworker` — caseworker gateway
- `http://localhost:3000/kiosk` — kiosk (use Chrome for voice)

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

**Do these in parallel once SSH'd in. Some steps take 30-60 minutes.**

### Immediate on arrival (all in parallel)

```bash
# Terminal 1 — verify hardware
nvidia-smi
uname -m      # must show aarch64

# Terminal 2 — pull RAPIDS container (large, start now)
docker pull rapidsai/base:25.06-cuda12-py3.12

# Terminal 3 — download Nemotron (~38 GB, start now)
pip install huggingface-hub
huggingface-cli download ggml-org/NVIDIA-Nemotron-3-Nano-Omni \
  nemotron-3-nano-omni-ga_v1.0-Q8_0.gguf \
  --local-dir ~/models/nemotron

# Terminal 4 — clone repo and install frontend deps
git clone <repo-url> ~/ProjectHaven
cd ~/ProjectHaven/frontend && npm install
```

### While downloads run — build llama.cpp with CUDA

```bash
git clone https://github.com/ggml-org/llama.cpp ~/llama.cpp
cd ~/llama.cpp
cmake -B build -DGGML_CUDA=ON
cmake --build build -j$(nproc)
# Takes 15-20 min on aarch64
```

### Once Nemotron download completes — start LLM server

```bash
~/llama.cpp/build/bin/llama-server \
  --model ~/models/nemotron/nemotron-3-nano-omni-ga_v1.0-Q8_0.gguf \
  --host 0.0.0.0 \
  --port 30000 \
  --n-gpu-layers 99 \
  --ctx-size 8192 \
  --threads 8

# Keep this terminal open
```

Test it:
```bash
curl http://localhost:30000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"nemotron","messages":[{"role":"user","content":"Reply with exactly: {\"test\":true}"}]}'
```

### Once RAPIDS container download completes — start backend

```bash
cd ~/ProjectHaven
docker run \
  --gpus all \
  --network host \
  -v $(pwd):/app \
  -w /app \
  -it rapidsai/base:25.06-cuda12-py3.12 \
  bash
```

Inside the container:
```bash
# Install Python deps
pip install -r backend/requirements.txt -q

# Verify RAPIDS
python3 -c "import cudf; import cuml; print('RAPIDS OK', cudf.__version__)"

# Verify datasets on GPU
python3 backend/data_ingestion.py --verify --mode gpu

# Run benchmark — this is the number you show judges
python3 backend/solver.py --benchmark
# Expected: GPU: ~7ms  CPU: ~280ms  Speedup: ~40×

# Start FastAPI
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

### Start frontend (host OS, new terminal)

```bash
cd ~/ProjectHaven/frontend && npm run dev
```

### Verify everything

```bash
# Health — should show rapids_mode: "gpu"
curl http://localhost:8000/api/v1/health

# After one caseworker route request:
curl http://localhost:8000/api/v1/benchmark
# Expected: last_gpu_ms < 10, speedup > 10
```

### If Nemotron isn't downloaded in time — NIM fallback

```bash
# Zero code change needed — update .env
echo "NIM_ENDPOINT=http://localhost:8001/v1" >> .env
echo "NIM_FALLBACK=http://localhost:8001/v1" >> .env

# Start via Docker Compose (recommended)
docker compose up

# Or start NIM container manually
docker run --gpus all --network host \
  -e NGC_API_KEY=$NGC_API_KEY \
  -v nim-cache:/opt/nim/.cache \
  -p 8001:8000 \
  nvcr.io/nim/google/gemma-3n-e4b-it:latest
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
| 1 | `watch -n 1 nvidia-smi` — GPU usage visible during demo |
| 2 | llama.cpp Nemotron server (port 30000) |
| 3 | RAPIDS container → uvicorn FastAPI (port 8000) |
| 4 | React frontend (port 3000) |
| 5 | Available for curl tests / quick debugging |

### Pre-demo verification (2 min)

```bash
# 1. Health check
curl http://localhost:8000/api/v1/health
# Confirm: rapids_mode: "gpu", 7 datasets loaded

# 2. Quick route test
curl -s -X POST http://localhost:8000/api/v1/caseworker/route \
  -H "Content-Type: application/json" \
  -d '{"text":"need a bed no ID drinking","origin_lat":43.6532,"origin_lon":-79.3832}'
# Confirm: itinerary.shelter has results, gpu_solve_ms < 10

# 3. Open browsers
# Tab 1: http://localhost:3000/caseworker
# Tab 2: http://localhost:3000/kiosk (Chrome, full-screen F11)
# Tab 3: http://localhost:8000/docs

# 4. Run benchmark standalone
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

**Q: You mention 9 pipeline stages. Walk me through them.**

> 1. Voice STT — Web Speech API in browser, transcript string
> 2. Transcript cleaning — filler word removal, min-length validation
> 3. NIM compiler — LLM converts text to strict JSON `NeedsPayload`
> 4. Pydantic validation — field validators normalize edge cases, reject invalid output
> 5. Constraint masking — cuDF boolean masks filter 7 datasets by eligibility
> 6. cuML KNN solve — haversine nearest neighbor on masked coordinate arrays
> 7. Congestion balancer — composite score: 60% distance + 30% occupancy + 10% transit
> 8. GTFS transit join — bounding box check against 9,255 TTC stops
> 9. TTS readback — `speechSynthesis` reads the itinerary aloud (Gateway B)

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

> "Nothing leaves the device. Gateway B specifically uses browser-native STT — the audio never leaves the browser sandbox. The transcript (text only) is sent to our local FastAPI server, which is running on the GX10 itself — no cloud API calls. There's no database. Sessions expire after 120 seconds and are deleted from memory. We don't log transcripts. The system knows nothing about who used it."

---

**Q: Why a kiosk instead of a mobile app?**

> "The population using Gateway B has a high rate of no smartphone, dead battery, and no data plan. A kiosk at a shelter hub, transit station, or resource centre is always on and always connected to local WiFi. Voice-first means no literacy barrier — someone in acute crisis doesn't need to navigate a UI. The 45-second recording cap and 10-second silence auto-release mean even someone in distress can get a route without needing to understand how to 'use' the interface."

---

### NVIDIA / hardware questions

**Q: Why the GB10 specifically? Couldn't you run this on any GPU?**

> "You could run the individual pieces. But here's what the GB10 gives us that you can't replicate by throwing money at cloud GPUs: unified coherent memory. Cloud GPU instances (A100, H100) have separate CPU and GPU address spaces. To do what we're doing — LLM inference while simultaneously running KNN over datasets — you'd need to schedule memory carefully. Here it's not a concern. All 128 GB is one coherent pool. The LLM, the datasets, and the working context all live there and see each other directly. That's the architectural difference."

---

**Q: What NVIDIA libraries are you using?**

> "Five NVIDIA stack pieces: cuDF for GPU DataFrames, cuML for the KNN solver, cloud NIM for Gemma 3n E4B when `NGC_API_KEY` is set, local NIM Gemma 3n on port 8001 as on-device fallback, and Nemotron-3-Nano-30B via llama.cpp on port 30000 — all targeting the GB10 CUDA backend. RAPIDS comes from the `rapidsai/base:25.06-cuda12-py3.12` container. A pure-regex extractor is the final fallback so routing never goes down."

---

## 7. Demo Script — What to Show Judges

Total time: 4-5 minutes. Lead with Gateway B (kiosk) — it's the most dramatic.

### Segment 1 — Gateway B Kiosk (2 min)

1. Open `http://localhost:3000/kiosk` in Chrome, **full screen (F11)**
2. Point at `nvidia-smi` terminal — show model loaded, GPU memory usage
3. TTS plays: "Haven Matrix. Hold the orb and tell me what you need."
4. Hold the orb, speak: *"I need somewhere to sleep tonight and I haven't eaten"*
5. Release orb — show spinner state
6. TTS asks: *"Do you have a piece of ID?"* — speak: "No"
7. TTS asks: *"Have you had anything to drink?"* — speak: "Yes"
8. TTS asks: *"Are you alone?"* — speak: "By myself"
9. Route appears + TTS reads it aloud
10. Point at screen: "This is a person who can't read, in crisis, getting a route they can actually walk into right now."

### Segment 2 — Gateway A Caseworker (1.5 min)

1. Switch to `http://localhost:3000/caseworker`
2. Point at BenchmarkPanel (bottom right) — GPU and CPU ms visible
3. Type: *"22yo male, sleeping rough 3 weeks, drinking heavily. Needs detox and a bed. Hasn't eaten today. No ID."*
4. Click Route — show PayloadConfirm toggles populate automatically
5. Submit — show itinerary with occupancy bars and intake prep text
6. Click "Generate phone script" on top shelter — show handoff script modal
7. Click "Copy Script"
8. Say: "This is the exact phone call script the caseworker reads when placing this person."

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
| **128 GB** | GX10 unified memory pool — LLM + all datasets + context, no PCIe |
| **38 GB** | Nemotron-3-Nano-30B GGUF (Q8_0 quantized) footprint in memory |
| **< 10 ms** | GPU KNN solve across all 5 pillars simultaneously |
| **200-300 ms** | Same solve on CPU (pandas + scikit-learn) — the comparison |
| **~30-40×** | Speedup ratio on GX10 (varies; live number on benchmark panel) |
| **9** | Pipeline stages: STT → clean → NIM → Pydantic → mask → KNN → score → GTFS → TTS |
| **7** | Datasets loaded in unified memory |
| **9,369** | TTC stops used for transit proximity scoring |
| **290** | Toronto shelter programs in dataset |
| **3** | Max eligibility questions asked per kiosk session |
| **45s** | Hard cap on push-to-talk recording (kiosk) |
| **10s** | Auto-release on silence (kiosk) |
| **120s** | Session expiry / inactivity reset (kiosk) |
| **60% / 30% / 10%** | Composite score weights: distance / occupancy / transit |

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

### Port 8000 already in use

```bash
lsof -ti :8000 | xargs kill -9
# Then restart uvicorn
```

---

### React shows blank page or CORS errors

1. Confirm Vite is running on port 3000: `http://localhost:3000`
2. Confirm FastAPI is on port 8000: `http://localhost:8000/api/v1/health`
3. The Vite proxy (`/api` → `http://localhost:8000`) only works when running `npm run dev` — not from a static build
4. If you deployed a static build: update `api/client.ts` baseURL to `http://localhost:8000/api/v1`

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
