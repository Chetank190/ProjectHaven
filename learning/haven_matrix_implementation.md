# Haven Matrix Triage — Full Implementation Document

> **NVIDIA Spark Hack Toronto · May 29–31 · OneEleven, 325 Front St W**
> Public Services Track · ASUS Ascent GX10 (GB10 Grace Blackwell · 128 GB Unified Memory)
> Submission deadline: **11:00 AM May 31** — target 10:30 AM

---

## Table of Contents

1. [Project Summary](#1-project-summary)
2. [System Architecture](#2-system-architecture)
3. [Tech Stack — Every Library Justified](#3-tech-stack--every-library-justified)
4. [Directory & File Structure](#4-directory--file-structure)
5. [Data Assets & Sourcing Strategy](#5-data-assets--sourcing-strategy)
6. [Voice Session Design](#6-voice-session-design)
7. [User Journey — Constraint-Aware Eligibility & Warm Handoff](#7-user-journey--constraint-aware-eligibility--warm-handoff)
8. [API Contract — FastAPI + Swagger](#8-api-contract--fastapi--swagger)
9. [Component Specifications](#9-component-specifications)
   - [config.py](#91-configpy)
   - [data_ingestion.py](#92-data_ingestionpy)
   - [nim_compiler.py](#93-nim_compilerpy)
   - [solver.py](#94-solverpy)
   - [voice_session.py](#95-voice_sessionpy)
   - [main.py (FastAPI)](#96-mainpy-fastapi)
   - [Frontend — Node.js + React](#97-frontend--nodejs--react)
10. [JSON Schema Contract](#10-json-schema-contract)
11. [Functional Requirements](#11-functional-requirements)
12. [Non-Functional Requirements](#12-non-functional-requirements)
13. [GX10 Setup — Step-by-Step](#13-gx10-setup--step-by-step)
14. [Sprint Timeline](#14-sprint-timeline)
15. [Rubric Coverage Map](#15-rubric-coverage-map)
16. [The Spark Story — Memorize This](#16-the-spark-story--memorize-this)
17. [Risk Register](#17-risk-register)
18. [Pre-Event Checklist](#18-pre-event-checklist)

---

## 1. Project Summary

**Haven Matrix** is a dual-gateway, offline-resilient triage engine that serves two distinct populations:

- **Gateway A — Caseworker**: A professional intake worker who enters or speaks client notes and receives a shift briefing + per-client multi-stop care itinerary with warm handoff scripts
- **Gateway B — Unhoused Person (Kiosk)**: A person in crisis who speaks naturally to the kiosk and receives voice-guided routing to resources they can actually access right now given their specific situation

All inference and data processing run locally on the GX10's 128 GB unified memory. No data about a person's situation — their sobriety, ID status, history — ever leaves the device.

### Two User Personas

| Persona | Gateway | Input | Output |
|---|---|---|---|
| **Caseworker Clara** | Gateway A | Text + optional voice | Shift briefing + per-client itinerary + warm handoff phone scripts |
| **Unhoused Person / Ken** | Gateway B | Voice only (push-to-talk) | Spoken care route to resources they can actually enter right now |

### Five Resource Pillars (all processed simultaneously on GPU)

| Pillar | Resource Type | Data Source |
|---|---|---|
| 1 | Emergency shelter | Toronto CKAN — daily shelter occupancy CSV |
| 2 | Clinical & rehab | Ontario Open Data — mental health org directory |
| 3 | Food & meals | Toronto CKAN — community services / food programs |
| 4 | Material supplies | Toronto CKAN — community services (clothing/blankets) |
| 5 | Hygiene stations | Community services + OSM pre-fetched JSON |

### What Makes This Win

- **Constraint-aware routing** — filters by what you can actually access (no ID, currently using, no sector match) not just what's nearest
- **LLM as a deterministic compiler** — converts unstructured speech or text into a strict GPU-ready boolean payload including eligibility constraints
- **Parallel 5-pillar GPU processing** — all datasets masked and solved simultaneously in under 10 ms
- **128 GB unified memory** — LLM context + all 7 data matrices live together with zero PCIe transfer penalty
- **Voice-first kiosk** — push-to-talk with auto-kill timeout, non-streaming audio buffer, TTS readback — no buttons, no literacy required
- **Warm handoff scripts** — LLM generates the phone call script a caseworker reads when placing a client with complex needs
- **Live CPU vs GPU benchmark panel** — makes the Spark Story a real number, not a claim

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                                         │
│                                                                               │
│  ┌──────────────────────────────┐    ┌──────────────────────────────────────┐│
│  │  Gateway A — Caseworker      │    │  Gateway B — Unhoused Person (Kiosk) ││
│  │  Node.js + React frontend    │    │  Node.js + React frontend            ││
│  │                              │    │                                      ││
│  │  [Text area] OR              │    │  VOICE ONLY — no buttons             ││
│  │  [🎤 Push-to-talk]           │    │                                      ││
│  │                              │    │  1. Kiosk speaks prompt aloud        ││
│  │  → JSON draft confirmation   │    │  2. Person holds button to speak     ││
│  │    (5 editable toggles)      │    │  3. Release = end of input           ││
│  │  → Shift briefing view       │    │  4. Auto-kill at 45s silence         ││
│  │  → Per-client itinerary      │    │  5. Route spoken back via TTS        ││
│  │  → Warm handoff script       │    │                                      ││
│  └──────────────┬───────────────┘    └──────────────────┬───────────────────┘│
└─────────────────┼────────────────────────────────────────┼────────────────────┘
                  │ HTTP POST                              │ HTTP POST
                  ▼                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FastAPI BACKEND  (port 8000)                               │
│                    Swagger UI at /docs                                        │
│                                                                               │
│  POST /api/v1/caseworker/route    — text or transcript → itinerary           │
│  POST /api/v1/kiosk/session       — audio blob → eligibility questions       │
│  POST /api/v1/kiosk/route         — eligibility answers + transcript → route │
│  POST /api/v1/caseworker/briefing — morning shift briefing generation        │
│  POST /api/v1/handoff-script      — itinerary → phone call script            │
│  GET  /api/v1/benchmark           — last GPU vs CPU latency stats            │
│  GET  /api/v1/health              — pipeline health check                    │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                LOCAL GPU SERVICES (llama.cpp / NIM)                           │
│                                                                               │
│  Nemotron-3-Nano-30B (Q8_0, ~38 GB VRAM)   ← primary, bounty eligible       │
│  OR Llama-3.1-8B-Instruct (FP8, ~16 GB)    ← fallback                       │
│                                                                               │
│  Strict system prompt → JSON-only output → Pydantic validation                │
│  Fallback: regex keyword extractor (if llama.cpp offline)                     │
│                                                                               │
│  OpenAI-compatible API: http://localhost:30000/v1/chat/completions            │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │ JSON needs payload + eligibility constraints
                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│              DATA & SOLVER LAYER (RAPIDS CUDA-X)                              │
│                     128 GB Unified Memory Pool                                │
│                                                                               │
│  cuDF DataFrames (all loaded at startup, never leave GPU memory)              │
│  shelters.csv | rehab_services.csv | food_banks.csv                           │
│  hygiene_stations.csv | grassroots_services.csv                               │
│  osm_amenities.json | stops.txt (TTC GTFS)                                   │
│                                                                               │
│  Constraint-aware boolean mask (5 pillars + eligibility filters)              │
│       ↓                                                                       │
│  cuML NearestNeighbors (haversine KNN) — sub-10ms                            │
│       ↓                                                                       │
│  Capacity + Congestion Balancer                                               │
│  score = w1×distance + w2×occupancy_ratio + w3×transit_flag                  │
│       ↓                                                                       │
│  Vector Search RAG (rehab pillar — cuML KNN on service_description)          │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │ ranked itinerary
                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        OUTPUT LAYER                                           │
│                                                                               │
│  JSON itinerary → FastAPI response → Node.js frontend render                 │
│  TTS audio      → browser speechSynthesis (both gateways)                    │
│  Handoff script → caseworker copy panel                                      │
│  Ticket text    → copyable SMS payload                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Architecture Principles

- **Zero-copy ingestion**: `cudf.read_csv()` loads directly into unified GPU memory — no CPU intermediary
- **Offline-resilient**: All data pre-cached locally. No live external API calls during demo
- **Dual-engine**: Every computation runs on both GPU (cuDF/cuML) and CPU (pandas/sklearn) for the benchmark panel
- **Local-first privacy**: A person's sobriety status, ID situation, and location never leave the GX10
- **Fallback chain**: LLM down → regex compiler. GPU down → pandas. CKAN down → local CSV cache
- **Voice-first kiosk**: No buttons on Gateway B — voice is the only interaction modality

---

## 3. Tech Stack — Every Library Justified

### Layer 1 — LLM Inference

| Library | Role | Why This One | Rubric Points |
|---|---|---|---|
| **NVIDIA NIM** (`nim-llm` Docker) | LLM serving for Llama 3.1 8B | Official NVIDIA playbook. Pre-optimized container. OpenAI API on port 8000. Named explicitly in rubric. | 15 pts (NVIDIA Stack) |
| **llama.cpp** (CUDA build) | LLM serving for Nemotron-3-Nano | Only way to run Nemotron GGUF on GX10. 30-min official playbook. Same OpenAI API on port 30000. | 15 pts + bounty |
| **Nemotron-3-Nano-30B** (Q8_0 GGUF) | Primary demo model | NVIDIA's own model. 3B active params in 30B MoE. ~38 GB VRAM. Built-in tool calling. Bounty eligible. | Bounty prize |
| **Llama-3.1-8B-Instruct** (FP8 via NIM) | Fallback model | Fastest JSON output. 16 GB VRAM. NIM playbook reference model. | — |
| **openai** Python SDK | API client | Points to `localhost:30000` or `localhost:8000`. Same code regardless of backend. | — |

> **Why not Ollama?** Developer forum reports confirm Ollama is significantly slower than vLLM/NIM on the GX10. No Nemotron bounty alignment.
>
> **Why not Triton directly?** Official DGX Spark playbooks use NIM containers (which wrap an optimized runtime) and llama.cpp for GGUF models. Triton is inside NIM, not alongside it.

### Layer 2 — GPU Data Processing (RAPIDS CUDA-X)

| Library | Role | Why This One | Rubric Points |
|---|---|---|---|
| **cuDF** | GPU DataFrame — ingest, mask, join | Drop-in pandas replacement. `cudf.read_csv()` = zero-copy to unified memory. Verified on Blackwell. | 15 pts + Spark Story |
| **cuML** | GPU KNN spatial solver + Vector RAG | Drop-in sklearn replacement. `NearestNeighbors` haversine. Sub-10ms on masked arrays. | 15 pts + 10 pts |
| **rapidsai/base** Docker image | Container for all RAPIDS code | ARM64 Grace Blackwell support. Never pip-install RAPIDS outside this container. | — |
| **pandas** | CPU benchmark path | Same API as cuDF. Flip import, runs on CPU. Used in FR-6 speedup comparison. | 10 pts (Performance) |
| **scikit-learn** | CPU KNN benchmark | Same API as cuML. Makes speedup ratio credible and comparable. | 10 pts (Performance) |

> **Critical**: Never install cuDF/cuML via pip on bare GX10 OS. ARM64 kernel issues documented in NVIDIA forums. Always work inside `rapidsai/base`.

### Layer 3 — Frontend (NEW)

| Library | Role | Why This One |
|---|---|---|
| **Node.js + React** | Frontend application | Clean separation from Python backend. Real component lifecycle for voice state machine. Easier push-to-talk button control than Streamlit HTML components. |
| **Vite** | Build tool | Fast dev server. Zero config. Works well with React + TypeScript. |
| **Web Speech API** | STT + TTS (browser-native) | Zero VRAM. Zero cloud. `webkitSpeechRecognition` for STT, `speechSynthesis` for TTS. Works on localhost. No external dependency. |
| **MediaRecorder API** | Non-streaming audio buffer | Captures full audio blob before sending. Used for Gateway B kiosk where we buffer the full utterance before processing — not streaming. |
| **Axios** | HTTP client | Calls FastAPI backend. Clean interceptors for error handling and timeout management. |
| **Tailwind CSS** | Styling | Rapid UI. No design system to maintain. Dark theme utilities for kiosk accessibility. |

### Layer 4 — Backend (NEW)

| Library | Role | Why This One |
|---|---|---|
| **FastAPI** | Python REST API | Async. Auto-generates OpenAPI/Swagger at `/docs`. Pydantic-native. Runs inside RAPIDS container alongside cuDF/cuML. |
| **Uvicorn** | ASGI server | Production-grade. Works with FastAPI. Single command startup. |
| **Swagger UI** | API testing | Built into FastAPI via `/docs`. Lets teammates test endpoints independently without touching the frontend. |

### Layer 5 — Infrastructure

| Component | Choice | Reason |
|---|---|---|
| **LLM container** | llama.cpp server (port 30000) | Nemotron GGUF. Or NIM container (port 8000) for Llama. Both expose identical OpenAI API. |
| **Backend container** | `rapidsai/base` (ARM64 CUDA12) | FastAPI + cuDF + cuML + all Python packages run here. |
| **Frontend** | Node.js process (port 3000) | Runs on host OS or separate container. Calls FastAPI at port 8000. |
| **Networking** | `--network host` on Docker | Backend and LLM containers on localhost. Frontend proxies to localhost:8000. |
| **Storage** | Local `data/` directory | All 7 files pre-downloaded. Mounted into RAPIDS container. No database. No Redis. |

---

## 4. Directory & File Structure

```
ProjectHaven/
│
├── data/
│   ├── shelters.csv              # Pillar 1 — Live from Toronto CKAN (refreshed at startup)
│   ├── rehab_services.csv        # Pillar 2 — Hand-compiled: ConnexOntario taxonomy + bypass paths
│   ├── food_banks.csv            # Pillar 3 — Static seed: food programs + operating hours
│   ├── hygiene_stations.csv      # Pillar 4+5 — Derived from community services CSV
│   ├── grassroots_services.csv   # Pillar 3+5 supplement — 211 Ontario mock asset
│   ├── osm_amenities.json        # Pillar 5 micro-layer — Pre-fetched OSM public amenities
│   └── stops.txt                 # Transit layer — TTC GTFS stops (9,255 entries)
│
├── backend/                      # Python FastAPI backend (runs inside RAPIDS container)
│   ├── main.py                   # FastAPI app — all routes, Swagger, CORS
│   ├── config.py                 # All constants: hubs, paths, weights, endpoints, schema
│   ├── data_ingestion.py         # cuDF/pandas loader with EngineMode enum + --verify flag
│   ├── nim_compiler.py           # LLM client + Pydantic validator + regex fallback
│   ├── solver.py                 # cuML KNN + congestion balancer + Vector RAG + --benchmark
│   ├── voice_session.py          # Audio buffer manager, session timeout, transcript cleanup
│   └── requirements.txt          # Python packages (pip inside RAPIDS container)
│
├── frontend/                     # Node.js + React frontend
│   ├── package.json
│   ├── vite.config.ts
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx               # Route: /caseworker vs /kiosk
│   │   ├── api/
│   │   │   └── client.ts         # Axios instance pointing to FastAPI backend
│   │   ├── components/
│   │   │   ├── GatewayA/
│   │   │   │   ├── CaseworkerPage.tsx
│   │   │   │   ├── VoiceInput.tsx        # Push-to-talk, text area, session timer display
│   │   │   │   ├── PayloadConfirm.tsx    # 5 editable toggles for NIM draft confirmation
│   │   │   │   ├── ShiftBriefing.tsx     # Morning briefing panel
│   │   │   │   ├── Itinerary.tsx         # Sequential multi-stop route display
│   │   │   │   ├── HandoffScript.tsx     # Generated phone call script
│   │   │   │   └── Ticket.tsx            # Copyable SMS ticket with client name
│   │   │   ├── GatewayB/
│   │   │   │   ├── KioskPage.tsx         # Full-screen dark, voice-only
│   │   │   │   ├── VoiceOrb.tsx          # Animated orb: idle / listening / processing / speaking
│   │   │   │   ├── EligibilityFlow.tsx   # Spoken eligibility questions + voice answers
│   │   │   │   └── KioskItinerary.tsx    # Large-text route + spoken readback
│   │   │   └── shared/
│   │   │       ├── BenchmarkPanel.tsx    # GPU vs CPU latency sidebar
│   │   │       └── useSpeech.ts          # Shared hook: STT + TTS + push-to-talk logic
│   └── public/
│
├── docker-compose.yml            # Wires LLM container + RAPIDS/FastAPI container
└── README.md                     # Run guide + architecture + Spark Story pitch
```

---

## 4A. Missing File Specs — Required Before Implementation

These files are referenced throughout the document but not fully specified. Cursor needs all of them.

### `frontend/package.json`

```json
{
  "name": "haven-matrix-frontend",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev":   "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react":       "^18.3.0",
    "react-dom":   "^18.3.0",
    "react-router-dom": "^6.24.0",
    "axios":       "^1.7.0"
  },
  "devDependencies": {
    "@types/react":     "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript":       "^5.4.0",
    "vite":             "^5.3.0",
    "tailwindcss":      "^3.4.0",
    "autoprefixer":     "^10.4.0",
    "postcss":          "^8.4.0"
  }
}
```

### `frontend/vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // Proxy all /api calls to FastAPI backend — required to avoid CORS preflight issues
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
```

> **Critical**: Without this proxy config, every Axios call will hit a CORS error even with `CORSMiddleware` on the backend. The proxy means requests go `browser → Vite dev server → FastAPI`, eliminating cross-origin entirely.

### `frontend/src/config.ts`

Mirror the voice timing constants from `backend/config.py` so `useSpeech.ts` can import them without a backend round-trip.

```typescript
// frontend/src/config.ts
// Mirror of backend/config.py voice constants — keep in sync manually

export const VOICE_HOLD_MAX_MS       = 45_000;  // hard cap on push-to-talk (45s)
export const VOICE_SILENCE_KILL_MS   = 10_000;  // auto-release on silence (10s)
export const VOICE_SESSION_IDLE_MS   = 120_000; // reset session to IDLE (120s)
export const VOICE_MIN_CHARS         = 10;       // min transcript length

export const API_BASE = '/api/v1';  // proxied through Vite — no hostname needed

export const KIOSK_HUBS: Record<string, [number, number]> = {
  'Union Station':      [43.6452, -79.3806],
  'Yonge & Dundas':     [43.6561, -79.3802],
  'Scarborough Centre': [43.7731, -79.2570],
  'Regent Park':        [43.6584, -79.3606],
  'Etobicoke Civic':    [43.6435, -79.5605],
};

// Set this at kiosk deployment time via env variable.
// Vite exposes VITE_ prefixed env vars to the browser.
// Default: Union Station. Override: VITE_KIOSK_HUB=Regent Park
export const KIOSK_DEFAULT_HUB = import.meta.env.VITE_KIOSK_HUB || 'Union Station';
```

### `frontend/src/types/api.ts`

Full TypeScript type tree for all API request and response shapes. Import these in every component — do not inline ad-hoc types.

```typescript
// frontend/src/types/api.ts

export interface NeedsPayload {
  needs_shelter:   boolean;
  needs_rehab:     boolean;
  needs_food:      boolean;
  needs_supplies:  boolean;
  needs_hygiene:   boolean;
  sector:          'youth' | 'adult' | 'family' | 'any';
  has_id:          boolean | null;
  sobriety_status: 'sober' | 'using' | null;
  group_size:      'alone' | 'with_family' | null;
}

export interface ItineraryResult {
  pillar:             string;
  name:               string;
  address:            string;
  lat:                number;
  lon:                number;
  distance_km:        number;
  distance_walk_min:  number;
  occupancy_ratio:    number;
  transit_accessible: boolean;
  composite_score:    number;
  phone:              string;
  hours:              string;
  requires_id:        boolean;
  harm_reduction:     boolean;
  bypass_pathway:     string;
  intake_preparation: string;
  accessible:         boolean;
}

export type Itinerary = Record<string, ItineraryResult[]>;

// POST /api/v1/caseworker/route request
export interface CaseworkerRouteRequest {
  text:        string;
  origin_lat:  number;
  origin_lon:  number;
  client_name?: string;
}

// POST /api/v1/caseworker/route response
export interface CaseworkerRouteResponse {
  payload:              NeedsPayload;
  compile_method:       'nim' | 'regex';
  nim_latency_ms:       number;
  gpu_solve_ms:         number;
  cpu_solve_ms:         number;
  speedup:              number | null;
  itinerary:            Itinerary;
  ticket_text:          string;
  eligibility_questions: string[];
}

// POST /api/v1/kiosk/session request
export interface KioskSessionRequest {
  transcript:  string;
  origin_lat:  number;
  origin_lon:  number;
}

// POST /api/v1/kiosk/session response
export interface KioskSessionResponse {
  session_id:             string;
  payload_draft:          NeedsPayload;
  eligibility_questions:  string[];
  next_step:              'collect_eligibility' | 'route';
}

// POST /api/v1/kiosk/route request
export interface KioskRouteRequest {
  session_id:           string;
  eligibility_answers:  Partial<Pick<NeedsPayload, 'has_id' | 'sobriety_status' | 'group_size'>>;
}

// POST /api/v1/kiosk/route response
export interface KioskRouteResponse {
  itinerary:    Itinerary;
  tts_script:   string;
  gpu_solve_ms: number;
}

// GET /api/v1/benchmark response
export interface BenchmarkResponse {
  last_gpu_ms: number | null;
  last_cpu_ms: number | null;
  speedup:     number | null;
}

// GET /api/v1/health response
export interface HealthResponse {
  status:        string;
  datasets:      Record<string, number>;
  total_records: number;
}

// FastAPI error response (422 validation or 400/404 HTTPException)
export interface ApiError {
  detail: string | { loc: string[]; msg: string; type: string }[];
}
```

### `frontend/src/App.tsx` — Routing spec

```typescript
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { CaseworkerPage } from './components/GatewayA/CaseworkerPage';
import { KioskPage }      from './components/GatewayB/KioskPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/caseworker" element={<CaseworkerPage />} />
        <Route path="/kiosk"      element={<KioskPage />} />
        {/* Default: redirect to caseworker for dev convenience */}
        <Route path="*" element={<Navigate to="/caseworker" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
```

Kiosk deployment: set the browser to launch at `http://localhost:3000/kiosk` in full-screen kiosk mode. No separate port or container needed.

### `frontend/src/components/GatewayB/EligibilityFlow.tsx` — Component spec

This is the most complex UI component. Specify it fully so Cursor doesn't invent the state machine.

```typescript
// Props
interface EligibilityFlowProps {
  questions:    string[];           // ordered list from /kiosk/session response
  onComplete:   (answers: Record<string, boolean | string | null>) => void;
  onSkip:       () => void;         // called if all questions timeout
}

// Internal state
type EligibilityState = 'speaking_question' | 'waiting_for_answer' | 'complete';

// Behaviour:
// 1. On mount: speak questions[0] via useSpeech.speak()
// 2. After TTS ends: enter WAITING_FOR_ANSWER state — show VoiceOrb in listening mode
// 3. Person holds orb → push-to-talk → releases
// 4. Transcript sent to parse_eligibility_answer() logic (client-side keyword match)
// 5. Store answer, advance to next question OR call onComplete() if last question
// 6. 30s timeout between questions → skip remaining → call onComplete() with nulls
// 7. Never show the question text on screen — voice only, no visual text of question
```

### `backend/requirements.txt`

Exact package list for inside the RAPIDS container. Install with `pip install -r backend/requirements.txt`.

```
fastapi==0.111.0
uvicorn[standard]==0.30.0
pydantic==2.7.0
openai==1.35.0
gtfs-kit==7.3.0
requests==2.32.0
pandas==2.2.0
numpy==1.26.0
scikit-learn==1.5.0
pyarrow==16.0.0
```

> **Note**: cuDF and cuML come pre-installed in `rapidsai/base`. Do NOT add them to requirements.txt — they will conflict with the container-native installation.

### `docker-compose.yml`

```yaml
version: "3.9"

services:
  # LLM inference server — llama.cpp with Nemotron
  # Start manually before docker-compose up if using llama.cpp binary (not a container)
  # OR use this service if using the NIM Docker container for Llama 3.1 8B
  nim:
    image: nvcr.io/nim/meta/llama-3.1-8b-instruct:latest
    runtime: nvidia
    environment:
      - NGC_API_KEY=${NGC_API_KEY}         # set in .env file
      - NIM_CACHE_PATH=/opt/nim/.cache
    volumes:
      - nim-cache:/opt/nim/.cache
    ports:
      - "8000:8000"                        # NIM exposes OpenAI API on 8000
    restart: unless-stopped

  # FastAPI backend — RAPIDS container with all Python deps
  backend:
    image: rapidsai/base:25.06-cuda12-py3.12
    runtime: nvidia
    working_dir: /app
    volumes:
      - .:/app                             # mount entire project
    ports:
      - "8001:8000"                        # FastAPI on host port 8001 (NIM uses 8000)
    command: >
      bash -c "
        pip install -r backend/requirements.txt -q &&
        uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
      "
    environment:
      - NIM_ENDPOINT=http://nim:8000/v1    # internal Docker network name
      - NIM_FALLBACK=http://nim:8000/v1    # same — only one NIM in compose
    depends_on:
      - nim
    restart: unless-stopped

volumes:
  nim-cache:
```

> **Compose vs manual setup**: For the hackathon, manually starting llama.cpp (for Nemotron) + the RAPIDS container is more reliable and easier to debug than compose. Use compose only if the team is comfortable with Docker networking. The manual steps in §13 are the recommended path.
>
> **Port mapping**: If using compose, update `config.py` so `NIM_ENDPOINT = "http://localhost:8001/v1"` to hit FastAPI from the host. Inside compose, services talk via service names (`nim`, `backend`).

---

---

## 5. Data Assets & Sourcing Strategy

### Dataset 1 — Daily Shelter Overnight Occupancy

- **Source**: Toronto Open Data CKAN — `open.toronto.ca/dataset/daily-shelter-overnight-service-occupancy-capacity/`
- **Format**: Live CSV, updated daily at 4 AM
- **Access**: Fetch via CKAN API at app startup. Cache to `data/shelters.csv`. Load from cache if fetch fails.
- **Key columns**: `ORGANIZATION_NAME`, `SHELTER_ADDRESS`, `SECTOR`, `SERVICE_USER_COUNT`, `CAPACITY_ACTUAL_BED`, `UNOCCUPIED_BEDS`, `LAT`, `LON`
- **Mask logic**: `UNOCCUPIED_BEDS > 0` AND `SECTOR == payload.sector` AND `requires_id == False` if `payload.has_id == False` AND `harm_reduction == True` if `payload.sobriety_status == "using"`
- **New columns to add in mock/derived data**: `requires_id` (bool), `harm_reduction` (bool), `accepts_walk_in` (bool)
- **FR-5 field**: `occupancy_ratio = SERVICE_USER_COUNT / CAPACITY_ACTUAL_BED`
- **Pillar**: 1 (Emergency Shelter)

### Dataset 2 — Community Services / Drop-In Programs

- **Source**: Toronto Open Data CKAN — search "drop-in" or "community services"
- **Format**: Static/periodic CSV
- **⚠️ Risk**: Column names must be audited on Day 1. Derive boolean flags from `SERVICE_TYPE` or `PROGRAM_DESCRIPTION` if needed.
- **Derived columns**: `has_showers` (bool), `has_laundry` (bool), `has_winter_clothing` (bool), `has_food` (bool), `requires_id` (bool), `harm_reduction` (bool)
- **Output files**: `data/hygiene_stations.csv`, `data/food_banks.csv`
- **Pillars**: 3 (Food), 4 (Supplies), 5 (Hygiene)

### Dataset 3 — Rehab Services (Mock Asset)

- **Original source**: ConnexOntario — Restricted, no public bulk export
- **Strategy**: Hand-compile `data/rehab_services.csv` from `connexontario.ca/search/`
- **Columns**: `organization_name`, `address`, `lat`, `lon`, `service_type`, `bed_count`, `phone`, `service_description`, `accepts_walk_in` (bool), `requires_id` (bool), `harm_reduction` (bool), `bypass_pathway` (text), `intake_preparation` (text)
- **Service types** (use ConnexOntario taxonomy verbatim): `Withdrawal Management`, `Crisis Stabilization Unit`, `Long-Term Residential Care`, `Outpatient Counselling`
- **bypass_pathway examples**:
  - "If you have no ID, tell intake you need an emergency ID letter. Ask for the ID clinic coordinator."
  - "If you're currently using, say you want harm reduction services — ask for the harm reduction coordinator specifically."
- **Target rows**: minimum 20 Toronto facilities
- **Pillar**: 2 (Clinical & Rehab)

### Dataset 4 — Grassroots Services (Mock Asset)

- **Original source**: 211 Ontario — Restricted, formal data agreement required
- **Strategy**: Hand-compile from `211.ca/search`, Daily Bread Food Bank directory, Toronto Drop-In Network member list
- **Columns**: `organization_name`, `address`, `lat`, `lon`, `service_type`, `hours`, `phone`, `requires_id` (bool), `harm_reduction` (bool), `bypass_pathway` (text), `intake_preparation` (text)
- **Target rows**: minimum 15 smaller orgs not in city data
- **Pillars**: 3 (Food) + 5 (Hygiene) supplement

### Dataset 5 — OSM Public Amenities

- **Source**: OpenStreetMap via Overpass API — **pre-fetch before event, never call live during demo**
- **Overpass query**:
  ```
  [out:json][timeout:60];
  (
    node["amenity"="toilets"](43.58,-79.65,43.86,-79.12);
    node["amenity"="drinking_water"](43.58,-79.65,43.86,-79.12);
    node["amenity"="charging_station"]["access"="yes"](43.58,-79.65,43.86,-79.12);
    node["social_facility"](43.58,-79.65,43.86,-79.12);
  );
  out body;
  ```
- **Pillar**: 5 (Hygiene — micro-infrastructure)

### Kiosk Location Resolution — Gateway B

The kiosk always knows its own location. Two strategies depending on deployment:

**Sprint strategy (recommended)**: Set `VITE_KIOSK_HUB` environment variable at browser launch time. The `frontend/src/config.ts` reads `KIOSK_DEFAULT_HUB` and looks it up in `KIOSK_HUBS` to get `origin_lat` / `origin_lon`. No user input required — the kiosk knows where it is.

**Demo fallback**: If `VITE_KIOSK_HUB` is not set, the `KioskPage.tsx` renders a full-screen hub selection screen (one large button per hub name, spoken by TTS) before entering the voice flow. The person says the hub name or taps the button to confirm. This is the only button allowed on Gateway B and only appears once per session.

In both cases, `origin_lat` and `origin_lon` are resolved **before** the first voice interaction begins and stored in component state. They are sent with every API call. There is no geolocation API call.

### Dataset 6 — TTC Static GTFS

- **Source**: Toronto Open Data CKAN — "TTC Routes and Schedules"
- **Files needed**: `stops.txt` only (9,255 stops with lat/lon)
- **Usage**: Transit proximity scoring — flag KNN results within 200m of a TTC stop
- **Layer**: Transit proximity scoring across all 5 pillars

---

## 6. Voice Session Design

This section defines the complete voice interaction model for both gateways. Read this before implementing `voice_session.py` or `useSpeech.ts`.

### Why Non-Streaming Audio (Buffered)

The Web Speech API `continuous = true` mode streams partial results as the person speaks. For a caseworker reading notes, this is fine. For an unhoused person in a noisy street environment, partial streaming causes: false triggers on background noise, incomplete sentences being submitted mid-utterance, and unpredictable pipeline starts.

**Gateway B uses buffered (non-streaming) audio instead:**

1. Person holds the push-to-talk button (or presses it once to start)
2. MediaRecorder captures audio chunks into a local buffer
3. On button release (or silence detection), recording stops
4. The full audio blob is sent to the backend as a single POST
5. Backend passes the transcript from webkitSpeechRecognition (which ran in the browser) or the buffered audio to the NIM compiler

This means the NIM only sees complete utterances, never partial thoughts.

### Push-to-Talk Interaction Model — Gateway B (Kiosk)

```
STATE MACHINE:

  IDLE
    │  Kiosk speaks: "Haven Matrix. Hold the button and tell me what you need."
    │  (Button appears on screen as a large circle)
    ▼
  BUTTON_HELD (user presses/holds)
    │  VoiceOrb animates: pulsing red — "I'm listening..."
    │  MediaRecorder starts capturing
    │  45-second hard timeout begins
    ▼
  BUTTON_RELEASED (or 45s timeout fires)
    │  MediaRecorder stops → audio blob finalized
    │  VoiceOrb animates: spinner — "Got it, finding help..."
    │  POST /api/v1/kiosk/session { audio_transcript: "..." }
    ▼
  ELIGIBILITY_QUESTIONS (if NIM detects shelter/rehab need)
    │  Backend returns up to 3 spoken questions
    │  Kiosk speaks question 1 via TTS
    │  Person holds button → answers → releases
    │  Repeat for each question (max 3 total, never more)
    ▼
  ROUTING
    │  POST /api/v1/kiosk/route with transcript + eligibility answers
    │  VoiceOrb: "Found something for you..."
    ▼
  SPEAKING_RESULT
    │  TTS reads itinerary aloud
    │  Large text appears on screen simultaneously
    │  "Preparation" text shown below each stop
    ▼
  IDLE (after 60s inactivity or explicit reset)
```

### Session Timeout Rules

| Condition | Timeout | Action |
|---|---|---|
| Button held with no audio detected | 10 seconds | Auto-release, play "I didn't hear anything. Press and hold to try again." |
| Button held, audio detected | 45 seconds hard cap | Force-stop recording, process whatever was captured |
| Waiting for person to press button | 120 seconds | Reset to IDLE, clear session data |
| TTS playing result | No timeout | Let it finish |
| Between eligibility questions | 30 seconds | Move to routing with answers collected so far |

These are constants in `config.py` so they can be tuned without code changes.

### Gateway A Voice Model (Caseworker)

Caseworkers get **both** text and voice. The voice mode is push-to-talk but with `continuous = false` and `interimResults = true` (streaming is acceptable because caseworkers are in a quieter environment and are professionals reading structured notes).

- Push-to-talk button OR keyboard shortcut (Space bar)
- Transcript appears in the text area in real time
- Person can edit the transcript before submitting
- 60-second session timeout with a visible countdown timer
- On timeout: auto-submit whatever transcript has been captured

### Audio Pipeline — Frontend to Backend

```
Browser (React)
│
├── Gateway B: MediaRecorder → audioBlob → base64 encode → POST body
│             webkitSpeechRecognition runs in parallel → transcript string
│             Both sent to backend: { transcript, audio_b64 (optional) }
│
└── Gateway A: webkitSpeechRecognition (continuous=false, interimResults=true)
              → transcript string only → POST body as text

Backend (FastAPI / voice_session.py)
│
├── Receives transcript string (primary)
├── Validates transcript length > MIN_CHARS (10)
├── Cleans transcript: strip filler words, normalize punctuation
├── Passes cleaned text to nim_compiler.compile_needs()
└── Returns NeedsPayload + eligibility_questions (if applicable)
```

### Spoken Eligibility Questions (Gateway B only)

The NIM produces a needs payload, then the backend checks which eligibility constraints apply. It asks **at most 3 questions**, in plain language, via TTS:

| Trigger condition | Question spoken |
|---|---|
| `needs_shelter == true` OR `needs_rehab == true` | "Do you have a piece of ID with you right now? Say yes or no." |
| `needs_shelter == true` | "Have you had anything to drink or used anything in the last few hours? No judgement — just yes or no." |
| `needs_shelter == true` AND no sector detected | "Are you alone, or do you have kids or family with you?" |

Answers are captured via push-to-talk, converted to a second transcript, and parsed by a lightweight keyword match (yes/no/alone/family) — **not** the full NIM, to avoid latency.

---

## 7. User Journey — Constraint-Aware Eligibility & Warm Handoff

### 7.1 Extended JSON Payload (with eligibility)

The NIM payload is extended with three eligibility fields gathered from the spoken questions:

```json
{
  "needs_shelter":    true,
  "needs_rehab":      false,
  "needs_food":       true,
  "needs_supplies":   false,
  "needs_hygiene":    false,
  "sector":           "adult",
  "has_id":           false,
  "sobriety_status":  "using",
  "group_size":       "alone"
}
```

These fields directly control the cuDF boolean mask in `solver.py`:
- `has_id == false` → exclude rows where `requires_id == true`
- `sobriety_status == "using"` → only include rows where `harm_reduction == true`
- `group_size == "with_family"` → prefer `SECTOR == "Families"` shelters

### 7.2 Constraint-Aware Routing Output

Each result in the itinerary includes:

- Standard: name, address, distance, walk time, transit flag, occupancy
- **New**: `accessible` (bool) — whether this resource is reachable given eligibility
- **New**: `bypass_pathway` (string) — what to say/do if standard access is blocked
- **New**: `intake_preparation` (string) — what to expect when you walk through the door

Example result object:

```json
{
  "pillar":            "shelter",
  "name":              "Seaton House",
  "address":           "339 George St, Toronto",
  "distance_km":       0.8,
  "distance_walk_min": 10,
  "transit_accessible": true,
  "accessible":        true,
  "bypass_pathway":    null,
  "intake_preparation": "When you arrive, a staff member will ask your name and whether you have ID. If you don't have ID, tell them you need help getting it — they can connect you with an ID clinic. Intake usually takes 15 minutes.",
  "occupancy_ratio":   0.72,
  "phone":             "416-392-0988",
  "hours":             "24 hours"
}
```

When `accessible == false` (e.g., shelter requires sobriety but person is currently using):

```json
{
  "accessible":        false,
  "bypass_pathway":    "This shelter requires sobriety on arrival. Tell them you want harm reduction services and ask for the harm reduction coordinator — they may be able to admit you under a different program. If not, the next option has a harm reduction policy.",
  "intake_preparation": null
}
```

### 7.3 Warm Handoff Script (Gateway A — Caseworker only)

After the itinerary is generated, a second NIM call generates a phone script for each stop where the caseworker needs to call ahead (shelter, detox, clinical services — not food banks or hygiene).

**Prompt to NIM** (simplified):

```
Generate a short, professional phone script for a Toronto social services caseworker
calling [FACILITY NAME] to arrange placement for a client with the following situation:
[PAYLOAD SUMMARY]

The script should:
- Be 4-6 sentences
- State the client's immediate needs clearly
- Ask the specific questions that determine admission eligibility
- Include a follow-up ask if the facility cannot help
- Not include the client's name
```

**Example output**:

```
"Hi, I'm calling from [your organization]. I have a client who needs a shelter bed tonight — 
adult male, currently in alcohol withdrawal but ambulatory and non-aggressive. Do you have 
capacity and are you able to accommodate someone in active withdrawal under your harm reduction 
policy? If not, can you recommend your intake coordinator or the next available alternative 
through Central Intake? I'm also looking to arrange detox intake for tomorrow morning — 
are you able to facilitate a warm transfer to a withdrawal management program?"
```

This is a second NIM call triggered by a "Generate Handoff Script" button in the caseworker interface, using the existing itinerary data as context. No new pipeline stages — just a new prompt.

### 7.4 Morning Shift Briefing (Gateway A — Pre-Shift)

Before going out, a caseworker (or team coordinator) clicks "Generate Shift Briefing." The system uses the freshest shelter CSV data and generates a plain-English summary:

**Prompt to NIM**:

```
Summarize the following Toronto shelter data for a social services outreach team starting 
their shift tonight. Write 3-5 sentences in plain English. Highlight: which sectors have 
the most available capacity, which shelters are nearly full, and any meal programs closing 
within 3 hours of [CURRENT_TIME]. Data: [SHELTER_DATA_SUMMARY]
```

**Example output**:

```
"As of this morning, the men's sector has the most available capacity with Seaton House 
showing 14 free beds. Eva's Initiative for women is at 97% — avoid unless urgent. 
The Scott Mission meal program runs until 8 PM tonight, which gives you about 4 hours. 
No family shelter is showing high vacancy right now, so for family placements tonight 
call Central Intake first before routing. Turning Point Detox has walk-in availability 
based on this morning's bed count."
```

This is one NIM call at shift start, triggered by a button. The solver is not invoked — this is a summarization task over the already-loaded shelter DataFrame.

---

## 8. API Contract — FastAPI + Swagger

All endpoints live in `backend/main.py`. Swagger UI is available at `http://localhost:8000/docs` for teammate testing without touching the frontend.

### POST `/api/v1/caseworker/route`

**Request body**:
```json
{
  "text": "Client is a 22yo male, sleeping rough for 3 weeks. Drinking heavily. Needs a bed and detox. Hasn't eaten today.",
  "origin_lat": 43.6532,
  "origin_lon": -79.3832,
  "client_name": "Marcus"
}
```

**Response**:
```json
{
  "payload": {
    "needs_shelter": true,
    "needs_rehab": true,
    "needs_food": true,
    "needs_supplies": false,
    "needs_hygiene": false,
    "sector": "adult",
    "has_id": null,
    "sobriety_status": null,
    "group_size": "alone"
  },
  "compile_method": "nim",
  "nim_latency_ms": 312,
  "gpu_solve_ms": 7,
  "cpu_solve_ms": 290,
  "itinerary": { ... },
  "ticket_text": "Care Route for Marcus — ...",
  "eligibility_questions": []
}
```

### POST `/api/v1/kiosk/session`

**Request body**:
```json
{
  "transcript": "I need somewhere to sleep tonight and I haven't eaten",
  "origin_lat": 43.6561,
  "origin_lon": -79.3802
}
```

**Response** (when eligibility questions are needed):
```json
{
  "session_id": "abc123",
  "payload_draft": { ... },
  "eligibility_questions": [
    "Do you have a piece of ID with you right now? Say yes or no.",
    "Have you had anything to drink or used anything in the last few hours? No judgement — just yes or no."
  ],
  "next_step": "collect_eligibility"
}
```

**Response** (when no eligibility questions needed):
```json
{
  "session_id": "abc123",
  "next_step": "route",
  "payload_draft": { ... }
}
```

### POST `/api/v1/kiosk/route`

**Request body**:
```json
{
  "session_id": "abc123",
  "eligibility_answers": {
    "has_id": false,
    "sobriety_status": "using",
    "group_size": "alone"
  }
}
```

**Response**:
```json
{
  "itinerary": { ... },
  "tts_script": "I found two places that can help you right now. First, stop at Turning Point at 10 Ossington. They accept people who are using and don't need ID. That's a 12 minute walk. After that...",
  "gpu_solve_ms": 8
}
```

### POST `/api/v1/caseworker/briefing`

**Request body**:
```json
{
  "current_time_iso": "2025-05-30T19:00:00-05:00"
}
```

**Response**:
```json
{
  "briefing_text": "As of this morning, the men's sector has...",
  "shelter_snapshot": { "total_beds": 4200, "available_beds": 312, "sectors": { ... } }
}
```

### POST `/api/v1/handoff-script`

**Request body**:
```json
{
  "facility_name": "Seaton House",
  "facility_phone": "416-392-0988",
  "payload": { ... }
}
```

**Response**:
```json
{
  "script": "Hi, I'm calling from [your organization]..."
}
```

### GET `/api/v1/benchmark`

**Response**:
```json
{
  "last_gpu_ms": 7.2,
  "last_cpu_ms": 290.4,
  "speedup": 40.3,
  "datasets_loaded": 7,
  "total_records": 14832
}
```

### GET `/api/v1/health`

**Response**:
```json
{
  "status": "ok",
  "nim_reachable": true,
  "nim_endpoint": "http://localhost:30000",
  "rapids_mode": "gpu",
  "datasets": {
    "shelters": 847,
    "rehab": 24,
    "food": 312,
    "hygiene": 189,
    "grassroots": 18,
    "osm": 2341,
    "stops": 9255
  }
}
```

---

## 9. Component Specifications

### 9.1 `config.py`

```python
from dataclasses import dataclass
from pathlib import Path
from enum import Enum

class EngineMode(Enum):
    GPU = "gpu"
    CPU = "cpu"

# ── Paths ─────────────────────────────────────────────────────────────────────
DATA_DIR            = Path("data")
SHELTERS_CSV        = DATA_DIR / "shelters.csv"
REHAB_CSV           = DATA_DIR / "rehab_services.csv"
FOOD_CSV            = DATA_DIR / "food_banks.csv"
HYGIENE_CSV         = DATA_DIR / "hygiene_stations.csv"
GRASSROOTS_CSV      = DATA_DIR / "grassroots_services.csv"
OSM_JSON            = DATA_DIR / "osm_amenities.json"
GTFS_STOPS_TXT      = DATA_DIR / "stops.txt"

# ── LLM Endpoints ─────────────────────────────────────────────────────────────
NIM_ENDPOINT        = "http://localhost:30000/v1"   # llama.cpp (Nemotron)
NIM_FALLBACK        = "http://localhost:8000/v1"    # NIM container (Llama 3.1 8B)
NIM_MODEL           = "nemotron"
NIM_TIMEOUT_SEC     = 15
NIM_MAX_RETRIES     = 2

# ── Toronto CKAN ──────────────────────────────────────────────────────────────
SHELTER_CKAN_URL = (
    "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search"
    "?resource_id=8a6eceb2-821b-4961-a29d-758f3087732d&limit=500"
)

# ── Kiosk Hub Coordinates (Gateway B pre-configured locations) ─────────────────
KIOSK_HUBS = {
    "Union Station":       (43.6452, -79.3806),
    "Yonge & Dundas":      (43.6561, -79.3802),
    "Scarborough Centre":  (43.7731, -79.2570),
    "Regent Park":         (43.6584, -79.3606),
    "Etobicoke Civic":     (43.6435, -79.5605),
}

# ── Voice Session Timeouts ────────────────────────────────────────────────────
VOICE_HOLD_MAX_SEC          = 45    # hard cap on push-to-talk duration
VOICE_SILENCE_KILL_SEC      = 10    # auto-release if no audio detected while held
VOICE_SESSION_IDLE_SEC      = 120   # reset to IDLE if no interaction
VOICE_ELIGIBILITY_WAIT_SEC  = 30    # wait between eligibility questions before skipping
VOICE_MIN_TRANSCRIPT_CHARS  = 10    # reject transcripts shorter than this

# ── Eligibility question triggers ─────────────────────────────────────────────
# Questions are only asked when these pillar needs are active
ASK_ID_FOR_PILLARS          = ["shelter", "rehab"]
ASK_SOBRIETY_FOR_PILLARS    = ["shelter"]
ASK_GROUP_FOR_PILLARS       = ["shelter"]

# ── Solver Weights (FR-5 Congestion Balancer) ─────────────────────────────────
WEIGHT_DISTANCE    = 0.60
WEIGHT_OCCUPANCY   = 0.30
WEIGHT_TRANSIT     = 0.10
TRANSIT_RADIUS_M   = 200
KNN_RESULTS_PER_PILLAR = 3

# ── JSON Output Schema ────────────────────────────────────────────────────────
# Used in NIM system prompt and Pydantic model — keep in sync
NEEDS_SCHEMA_DESCRIPTION = """
{
  "needs_shelter":   <true|false>,
  "needs_rehab":     <true|false>,
  "needs_food":      <true|false>,
  "needs_supplies":  <true|false>,
  "needs_hygiene":   <true|false>,
  "sector":          <"youth"|"adult"|"family"|"any">,
  "has_id":          <true|false|null>,
  "sobriety_status": <"sober"|"using"|null>,
  "group_size":      <"alone"|"with_family"|null>
}
"""

# ── NIM System Prompts ────────────────────────────────────────────────────────
NIM_TRIAGE_PROMPT = """You are a deterministic JSON compiler for a social services triage system.

Your ONLY job is to read input (caseworker notes or a person's spoken words) and output a
single valid JSON object. Output NOTHING else — no explanation, no markdown, no preamble.

JSON schema (all fields required):
{
  "needs_shelter":   <true|false>,
  "needs_rehab":     <true|false>,
  "needs_food":      <true|false>,
  "needs_supplies":  <true|false>,
  "needs_hygiene":   <true|false>,
  "sector":          <"youth"|"adult"|"family"|"any">,
  "has_id":          <true|false|null>,
  "sobriety_status": <"sober"|"using"|null>,
  "group_size":      <"alone"|"with_family"|null>
}

Field rules:
- needs_shelter: true if person needs a bed, shelter, place to sleep, or housing
- needs_rehab: true if any mention of drugs, alcohol, detox, withdrawal, mental health crisis
- needs_food: true if person is hungry, needs food, a meal, food bank
- needs_supplies: true if person needs clothing, blankets, winter gear
- needs_hygiene: true if person needs a shower, laundry, washroom, or hygiene items
- sector: infer from age/demographic; default to "any"
- has_id: only set if explicitly mentioned; otherwise null
- sobriety_status: only set if explicitly mentioned; otherwise null
- group_size: only set if explicitly mentioned; otherwise null
"""

NIM_BRIEFING_PROMPT = """You are writing a shift briefing for a Toronto social services outreach team.
Summarize the data in 3-5 plain-English sentences. Focus on: which sectors have capacity,
which are nearly full, and any time-sensitive meal programs. Be direct and practical.
Do not use jargon. Output only the briefing text, no preamble."""

NIM_HANDOFF_PROMPT = """You are writing a phone script for a Toronto social services caseworker.
Write 4-6 sentences. State the client's needs clearly (no name). Ask the specific question
that determines admission eligibility for this facility. Include a follow-up ask if they
cannot help. Professional tone. Output only the script text, no preamble."""
```

---

### 9.2 `data_ingestion.py`

```python
"""
data_ingestion.py
Zero-copy RAPIDS ingestion (GPU) with pandas fallback (CPU).
Run: python data_ingestion.py --verify [--mode gpu|cpu]
"""

import time, json, argparse
from pathlib import Path
from config import (EngineMode, SHELTERS_CSV, REHAB_CSV, FOOD_CSV, HYGIENE_CSV,
                    GRASSROOTS_CSV, OSM_JSON, GTFS_STOPS_TXT, SHELTER_CKAN_URL)


def load_all(mode: EngineMode = EngineMode.GPU) -> tuple[dict, float]:
    """Load all 7 datasets. Returns (datasets_dict, load_time_ms)."""
    if mode == EngineMode.GPU:
        import cudf as pd_engine
    else:
        import pandas as pd_engine

    t0 = time.perf_counter()
    datasets = {}

    # Shelter — live CKAN with local fallback
    shelters = _fetch_shelters_ckan(pd_engine)
    if shelters is None:
        shelters = pd_engine.read_csv(SHELTERS_CSV)
    shelters = _standardize_coords(shelters, lat_col="LAT", lon_col="LON")
    shelters["occupancy_ratio"] = (
        shelters["SERVICE_USER_COUNT"] / shelters["CAPACITY_ACTUAL_BED"].clip(lower=1)
    ).clip(upper=1.0)
    # Add eligibility columns if missing (for datasets without them yet)
    for col, default in [("requires_id", False), ("harm_reduction", True), ("accepts_walk_in", True)]:
        if col not in shelters.columns:
            shelters[col] = default
    datasets["shelters"] = shelters

    # All other datasets
    for key, path in [("rehab", REHAB_CSV), ("food", FOOD_CSV),
                       ("hygiene", HYGIENE_CSV), ("grassroots", GRASSROOTS_CSV)]:
        df = pd_engine.read_csv(path)
        df = _standardize_coords(df)
        for col, default in [("requires_id", False), ("harm_reduction", True)]:
            if col not in df.columns:
                df[col] = default
        if "bypass_pathway" not in df.columns:
            df["bypass_pathway"] = ""
        datasets[key] = df

    datasets["osm"] = _load_osm(pd_engine)
    datasets["stops"] = pd_engine.read_csv(
        GTFS_STOPS_TXT, usecols=["stop_id", "stop_name", "stop_lat", "stop_lon"]
    ).rename(columns={"stop_lat": "lat", "stop_lon": "lon"})

    elapsed_ms = (time.perf_counter() - t0) * 1000
    print(f"[{mode.value.upper()}] Loaded {sum(len(d) for d in datasets.values())} "
          f"total records in {elapsed_ms:.2f} ms")
    return datasets, elapsed_ms


def _fetch_shelters_ckan(pd_engine):
    try:
        import requests, pandas as pd
        r = requests.get(SHELTER_CKAN_URL, timeout=10)
        r.raise_for_status()
        df = pd.DataFrame(r.json()["result"]["records"])
        df.to_csv(SHELTERS_CSV, index=False)
        return pd_engine.from_pandas(df) if hasattr(pd_engine, "from_pandas") else df
    except Exception as e:
        print(f"[WARN] CKAN fetch failed ({e}), using cache")
        return None


def _load_osm(pd_engine):
    import pandas as pd
    with open(OSM_JSON) as f:
        raw = json.load(f)
    rows = [{"osm_id": el.get("id"),
             "name": el.get("tags", {}).get("name", "Public facility"),
             "amenity": el.get("tags", {}).get("amenity") or el.get("tags", {}).get("social_facility"),
             "lat": float(el.get("lat", 0)), "lon": float(el.get("lon", 0))}
            for el in raw.get("elements", [])]
    df = pd.DataFrame(rows)
    df["requires_id"] = False
    df["harm_reduction"] = True
    df["bypass_pathway"] = ""
    return pd_engine.from_pandas(df) if hasattr(pd_engine, "from_pandas") else df


def _standardize_coords(df, lat_col="lat", lon_col="lon"):
    rename_map = {}
    for c in df.columns:
        cl = c.lower()
        if cl in ("latitude", "lat", "y") and c != "lat":
            rename_map[c] = "lat"
        if cl in ("longitude", "lon", "lng", "x") and c != "lon":
            rename_map[c] = "lon"
    if lat_col != "lat": rename_map[lat_col] = "lat"
    if lon_col != "lon": rename_map[lon_col] = "lon"
    if rename_map:
        df = df.rename(columns=rename_map)
    df["lat"] = df["lat"].astype("float32")
    df["lon"] = df["lon"].astype("float32")
    return df


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--mode", choices=["gpu", "cpu"], default="gpu")
    args = parser.parse_args()
    mode = EngineMode.GPU if args.mode == "gpu" else EngineMode.CPU
    datasets, elapsed = load_all(mode)
    for name, df in datasets.items():
        print(f"  ✓ {name:<15} {len(df):>6} rows")
    print(f"\nTotal: {elapsed:.2f} ms")
```

---

### 9.3 `nim_compiler.py`

```python
"""
nim_compiler.py
LLM client for needs extraction, briefing, and handoff script generation.
All three NIM call types live here. Regex fallback for triage when LLM offline.
"""

import re, json, time
from openai import OpenAI
from pydantic import BaseModel, validator
from config import (NIM_ENDPOINT, NIM_FALLBACK, NIM_MODEL, NIM_TIMEOUT_SEC,
                    NIM_MAX_RETRIES, NIM_TRIAGE_PROMPT, NIM_BRIEFING_PROMPT,
                    NIM_HANDOFF_PROMPT)


class NeedsPayload(BaseModel):
    needs_shelter:   bool
    needs_rehab:     bool
    needs_food:      bool
    needs_supplies:  bool
    needs_hygiene:   bool
    sector:          str        # "youth" | "adult" | "family" | "any"
    has_id:          bool | None = None
    sobriety_status: str | None = None   # "sober" | "using" | None
    group_size:      str | None = None   # "alone" | "with_family" | None

    @validator("sector")
    def sector_valid(cls, v):
        return v.lower() if v.lower() in {"youth", "adult", "family", "any"} else "any"

    @validator("sobriety_status")
    def sobriety_valid(cls, v):
        return v if v in {"sober", "using", None} else None

    @validator("group_size")
    def group_valid(cls, v):
        return v if v in {"alone", "with_family", None} else None


def compile_needs(text: str) -> tuple[NeedsPayload, str, float]:
    """text → NeedsPayload. Returns (payload, method, latency_ms)."""
    t0 = time.perf_counter()
    for endpoint in [NIM_ENDPOINT, NIM_FALLBACK]:
        for attempt in range(NIM_MAX_RETRIES + 1):
            try:
                payload = _call_nim(text, endpoint, NIM_TRIAGE_PROMPT)
                return NeedsPayload(**payload), "nim", (time.perf_counter() - t0) * 1000
            except Exception as e:
                print(f"[NIM triage] attempt {attempt+1} at {endpoint}: {e}")
    return _regex_fallback(text), "regex", (time.perf_counter() - t0) * 1000


def generate_briefing(shelter_summary: str) -> str:
    """Summarize morning shelter data into plain-English shift briefing."""
    for endpoint in [NIM_ENDPOINT, NIM_FALLBACK]:
        try:
            client = OpenAI(base_url=endpoint, api_key="not-needed")
            resp = client.chat.completions.create(
                model=NIM_MODEL,
                messages=[{"role": "system", "content": NIM_BRIEFING_PROMPT},
                           {"role": "user", "content": shelter_summary}],
                temperature=0.3, max_tokens=300, timeout=NIM_TIMEOUT_SEC
            )
            return resp.choices[0].message.content.strip()
        except Exception as e:
            print(f"[NIM briefing] {endpoint}: {e}")
    return "Briefing unavailable — check shelter data manually."


def generate_handoff_script(facility_name: str, payload: NeedsPayload) -> str:
    """Generate phone call script for caseworker placing a client."""
    context = (f"Facility: {facility_name}. Client needs: "
               f"{'shelter ' if payload.needs_shelter else ''}"
               f"{'detox/mental health ' if payload.needs_rehab else ''}"
               f"{'food ' if payload.needs_food else ''}. "
               f"Sector: {payload.sector}. "
               f"Has ID: {payload.has_id}. "
               f"Sobriety: {payload.sobriety_status}.")
    for endpoint in [NIM_ENDPOINT, NIM_FALLBACK]:
        try:
            client = OpenAI(base_url=endpoint, api_key="not-needed")
            resp = client.chat.completions.create(
                model=NIM_MODEL,
                messages=[{"role": "system", "content": NIM_HANDOFF_PROMPT},
                           {"role": "user", "content": context}],
                temperature=0.4, max_tokens=250, timeout=NIM_TIMEOUT_SEC
            )
            return resp.choices[0].message.content.strip()
        except Exception as e:
            print(f"[NIM handoff] {endpoint}: {e}")
    return "Script unavailable — compose the call manually using the client's needs above."


def _call_nim(text: str, endpoint: str, system_prompt: str) -> dict:
    client = OpenAI(base_url=endpoint, api_key="not-needed")
    resp = client.chat.completions.create(
        model=NIM_MODEL,
        messages=[{"role": "system", "content": system_prompt},
                   {"role": "user", "content": text}],
        temperature=0.0, max_tokens=200, timeout=NIM_TIMEOUT_SEC
    )
    raw = resp.choices[0].message.content.strip()
    raw = re.sub(r"^```json\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    return json.loads(raw)


def _regex_fallback(text: str) -> NeedsPayload:
    t = text.lower()
    def match(kws): return any(k in t for k in kws)

    sector = "any"
    if match(["youth", "young", "teenager", "teen", "minor", "kid"]): sector = "youth"
    elif match(["family", "children", "kids", "child", "baby", "pregnant"]): sector = "family"
    elif match(["man", "woman", "adult"]): sector = "adult"

    has_id = True if match(["have id", "got id", "have my id"]) else \
             False if match(["no id", "lost my id", "don't have id", "without id"]) else None
    sobriety = "using" if match(["using", "drunk", "high", "on something", "been drinking"]) else \
               "sober" if match(["sober", "clean", "not using"]) else None
    group = "with_family" if match(["family", "kids", "children", "baby"]) else \
            "alone" if match(["alone", "by myself", "just me"]) else None

    return NeedsPayload(
        needs_shelter=  match(["shelter", "bed", "sleep", "housing", "place to stay", "homeless"]),
        needs_rehab=    match(["rehab", "detox", "withdrawal", "drug", "alcohol", "mental health", "crisis"]),
        needs_food=     match(["food", "hungry", "eat", "meal", "soup kitchen", "food bank"]),
        needs_supplies= match(["clothing", "clothes", "jacket", "coat", "blanket", "warm"]),
        needs_hygiene=  match(["shower", "wash", "laundry", "hygiene", "washroom", "bathroom"]),
        sector=sector, has_id=has_id, sobriety_status=sobriety, group_size=group
    )


def kiosk_voice_payload(needs_transcript: str, eligibility_answers: dict) -> NeedsPayload:
    """Merge NIM triage of voice transcript with separately collected eligibility answers."""
    payload, _, _ = compile_needs(needs_transcript)
    payload_dict = payload.dict()
    payload_dict.update({k: v for k, v in eligibility_answers.items() if v is not None})
    return NeedsPayload(**payload_dict)
```

---

### 9.4 `solver.py`

```python
"""
solver.py
Constraint-aware cuML KNN solver. Eligibility fields filter datasets before spatial solve.
Run: python solver.py --benchmark
"""

import time, argparse
from config import (EngineMode, KNN_RESULTS_PER_PILLAR, WEIGHT_DISTANCE,
                    WEIGHT_OCCUPANCY, WEIGHT_TRANSIT, TRANSIT_RADIUS_M)
from nim_compiler import NeedsPayload


def solve(payload: NeedsPayload, datasets: dict,
          origin: tuple[float, float], mode: EngineMode = EngineMode.GPU) -> tuple[dict, float]:
    if mode == EngineMode.GPU:
        from cuml.neighbors import NearestNeighbors
        import cudf as pd_engine, cupy as np_engine
    else:
        from sklearn.neighbors import NearestNeighbors
        import pandas as pd_engine, numpy as np_engine

    t0 = time.perf_counter()
    masked = _apply_masks(payload, datasets, pd_engine)
    origin_arr = np_engine.array([[origin[0], origin[1]]], dtype="float32")
    itinerary = {}

    for pillar_name, df in masked.items():
        if df is None or len(df) == 0:
            itinerary[pillar_name] = []
            continue
        coords = df[["lat", "lon"]].values.astype("float32")
        knn = NearestNeighbors(
            n_neighbors=min(KNN_RESULTS_PER_PILLAR * 3, len(df)),
            metric="haversine", algorithm="brute"
        )
        knn.fit(np_engine.deg2rad(coords))
        distances, indices = knn.kneighbors(np_engine.deg2rad(origin_arr))
        distances_km = distances * 6371.0
        results = _score_and_rank(df, indices, distances_km, datasets["stops"], pillar_name)
        itinerary[pillar_name] = results[:KNN_RESULTS_PER_PILLAR]

    return itinerary, (time.perf_counter() - t0) * 1000


def _apply_masks(payload: NeedsPayload, datasets: dict, pd_engine) -> dict:
    """Constraint-aware boolean masking — filters by eligibility fields in payload."""
    masked = {}

    def eligibility_mask(df):
        """Apply ID and harm reduction filters based on payload eligibility."""
        m = pd_engine.Series([True] * len(df), index=df.index)
        if payload.has_id is False and "requires_id" in df.columns:
            m = m & (df["requires_id"] == False)
        if payload.sobriety_status == "using" and "harm_reduction" in df.columns:
            m = m & (df["harm_reduction"] == True)
        return m

    if payload.needs_shelter:
        df = datasets["shelters"]
        m = (df["UNOCCUPIED_BEDS"] > 0) & eligibility_mask(df)
        if payload.sector != "any":
            sector_map = {"youth": ["Youth"], "adult": ["Men", "Women", "Co-ed"],
                          "family": ["Families"]}
            m = m & df["SECTOR"].isin(sector_map.get(payload.sector, []))
        if payload.group_size == "with_family":
            family_mask = df["SECTOR"].isin(["Families"])
            m = m & family_mask
        masked["shelter"] = df[m].copy()

    if payload.needs_rehab:
        df = datasets["rehab"]
        masked["rehab"] = df[eligibility_mask(df)].copy()

    if payload.needs_food:
        food_all = pd_engine.concat([datasets["food"], datasets["grassroots"]])
        masked["food"] = food_all.copy()

    if payload.needs_supplies:
        df = datasets["hygiene"]
        m = eligibility_mask(df)
        if "has_winter_clothing" in df.columns:
            m = m & (df["has_winter_clothing"] == True)
        masked["supplies"] = df[m].copy()

    if payload.needs_hygiene:
        df = datasets["hygiene"]
        osm = datasets["osm"]
        hygiene_all = pd_engine.concat([df, osm])
        masked["hygiene"] = hygiene_all.copy()

    return masked


def _score_and_rank(df, indices, distances_km, stops_df, pillar_name) -> list:
    try:
        idx_list = indices[0].tolist()
        dist_list = distances_km[0].tolist()
    except Exception:
        idx_list, dist_list = list(indices[0]), list(distances_km[0])

    max_dist = max(dist_list) if dist_list else 1.0
    results = []

    for idx, dist_km in zip(idx_list, dist_list):
        row = df.iloc[int(idx)]
        occ  = float(row.get("occupancy_ratio", 0.5))
        transit = _check_transit(float(row["lat"]), float(row["lon"]), stops_df)
        score = (WEIGHT_DISTANCE  * (dist_km / max_dist) +
                 WEIGHT_OCCUPANCY * occ +
                 WEIGHT_TRANSIT   * (0 if transit else 1))

        results.append({
            "pillar":             pillar_name,
            "name":               str(row.get("organization_name") or row.get("name", "Unknown")),
            "address":            str(row.get("address") or row.get("SHELTER_ADDRESS", "")),
            "lat":                float(row["lat"]),
            "lon":                float(row["lon"]),
            "distance_km":        round(dist_km, 2),
            "distance_walk_min":  round(dist_km / 0.084, 0),
            "occupancy_ratio":    round(occ, 2),
            "transit_accessible": transit,
            "composite_score":    round(score, 4),
            "phone":              str(row.get("phone", "")),
            "hours":              str(row.get("hours", "")),
            "requires_id":        bool(row.get("requires_id", False)),
            "harm_reduction":     bool(row.get("harm_reduction", True)),
            "bypass_pathway":     str(row.get("bypass_pathway", "")),
            "intake_preparation": str(row.get("intake_preparation", "")),
            # accessible=True because eligibility mask already excluded inaccessible rows.
            # The bypass_pathway field handles the "what to do if turned away" case —
            # it does not mean the resource is inaccessible, it means there is a fallback
            # if on-arrival conditions differ from the dataset. Do NOT set accessible=False
            # in this path — that would require a second unfiltered KNN pass which is
            # outside sprint scope. The example in §7.2 showing accessible=false is the
            # future roadmap item, not current implementation.
            "accessible":         True,
        })

    return sorted(results, key=lambda x: x["composite_score"])


def _check_transit(lat, lon, stops_df) -> bool:
    try:
        lat_t = TRANSIT_RADIUS_M / 111_000
        lon_t = TRANSIT_RADIUS_M / 73_000
        return len(stops_df[(abs(stops_df["lat"] - lat) < lat_t) &
                             (abs(stops_df["lon"] - lon) < lon_t)]) > 0
    except Exception:
        return False


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--benchmark", action="store_true")
    args = parser.parse_args()
    if args.benchmark:
        from data_ingestion import load_all
        test_payload = NeedsPayload(needs_shelter=True, needs_rehab=True, needs_food=True,
                                    needs_supplies=False, needs_hygiene=True, sector="adult",
                                    has_id=False, sobriety_status="using", group_size="alone")
        origin = (43.6532, -79.3832)
        print("Loading...")
        dg, _ = load_all(EngineMode.GPU)
        dc, _ = load_all(EngineMode.CPU)
        _, gms = solve(test_payload, dg, origin, EngineMode.GPU)
        _, cms = solve(test_payload, dc, origin, EngineMode.CPU)
        print(f"GPU: {gms:.2f}ms  CPU: {cms:.2f}ms  Speedup: {cms/gms:.1f}×")
```

---

### 9.5 `voice_session.py`

```python
"""
voice_session.py
Audio session management: transcript cleaning, eligibility question logic,
session state tracking, and timeout enforcement.
All voice timing constants come from config.py — tune without touching this file.
"""

import time
import uuid
from dataclasses import dataclass, field
from config import (VOICE_HOLD_MAX_SEC, VOICE_SILENCE_KILL_SEC,
                    VOICE_SESSION_IDLE_SEC, VOICE_MIN_TRANSCRIPT_CHARS,
                    ASK_ID_FOR_PILLARS, ASK_SOBRIETY_FOR_PILLARS, ASK_GROUP_FOR_PILLARS)
from nim_compiler import NeedsPayload


@dataclass
class VoiceSession:
    session_id:           str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    created_at:           float = field(default_factory=time.time)
    payload_draft:        NeedsPayload | None = None
    eligibility_answers:  dict = field(default_factory=dict)
    questions_asked:      list = field(default_factory=list)
    origin:               tuple | None = None


# In-memory session store (keyed by session_id)
# Sessions expire after VOICE_SESSION_IDLE_SEC — cleaned up on next request
_sessions: dict[str, VoiceSession] = {}


def create_session(payload: NeedsPayload, origin: tuple) -> VoiceSession:
    s = VoiceSession(payload_draft=payload, origin=origin)
    _sessions[s.session_id] = s
    return s


def get_session(session_id: str) -> VoiceSession | None:
    _cleanup_expired()
    return _sessions.get(session_id)


def resolve_eligibility_questions(payload: NeedsPayload) -> list[str]:
    """
    Determine which eligibility questions to ask based on active pillars.
    Returns ordered list of question strings (max 3, in plain language for TTS).
    Questions are only asked if the answer isn't already known from the transcript.
    """
    questions = []
    active = [p for p in ["shelter", "rehab", "food", "hygiene"] if getattr(payload, f"needs_{p}")]

    if any(p in ASK_ID_FOR_PILLARS for p in active) and payload.has_id is None:
        questions.append("Do you have a piece of ID with you right now? Just say yes or no.")

    if any(p in ASK_SOBRIETY_FOR_PILLARS for p in active) and payload.sobriety_status is None:
        questions.append(
            "Have you had anything to drink or used anything in the last few hours? "
            "No judgement — just say yes or no."
        )

    if any(p in ASK_GROUP_FOR_PILLARS for p in active) and payload.group_size is None:
        questions.append(
            "Are you on your own, or do you have family or children with you?"
        )

    return questions[:3]  # hard cap — never more than 3 questions


def parse_eligibility_answer(question_text: str, answer_transcript: str) -> dict:
    """
    Parse a single yes/no/descriptive answer into an eligibility dict update.
    Uses keyword matching — not the NIM — to keep latency minimal.
    """
    t = answer_transcript.lower().strip()

    # Question type detection by keywords in the question
    if "id" in question_text.lower():
        if any(w in t for w in ["yes", "yeah", "yep", "have it", "got it"]):
            return {"has_id": True}
        if any(w in t for w in ["no", "nope", "don't have", "lost", "don't"]):
            return {"has_id": False}
        return {"has_id": None}

    if "drink" in question_text.lower() or "used" in question_text.lower():
        if any(w in t for w in ["yes", "yeah", "yep", "have been", "little bit", "bit"]):
            return {"sobriety_status": "using"}
        if any(w in t for w in ["no", "nope", "sober", "clean", "haven't"]):
            return {"sobriety_status": "sober"}
        return {"sobriety_status": None}

    if "family" in question_text.lower() or "children" in question_text.lower():
        if any(w in t for w in ["family", "kids", "children", "baby", "wife", "husband",
                                  "partner", "with someone"]):
            return {"group_size": "with_family"}
        if any(w in t for w in ["alone", "myself", "just me", "on my own", "solo"]):
            return {"group_size": "alone"}
        return {"group_size": None}

    return {}


def clean_transcript(raw: str) -> str:
    """
    Remove filler words, normalize punctuation, and validate minimum length.
    Returns cleaned transcript or raises ValueError if too short.
    """
    if not raw or len(raw.strip()) < VOICE_MIN_TRANSCRIPT_CHARS:
        raise ValueError(f"Transcript too short (min {VOICE_MIN_TRANSCRIPT_CHARS} chars)")

    fillers = ["um", "uh", "like", "you know", "i mean", "kind of", "sort of"]
    cleaned = raw.strip()
    for f in fillers:
        cleaned = cleaned.replace(f" {f} ", " ")

    import re
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def build_tts_itinerary_script(itinerary: dict, client_name: str | None = None) -> str:
    """
    Convert itinerary dict into a natural TTS-friendly script.
    Short sentences. No jargon. Spoken walking directions.
    """
    lines = []
    greeting = f"Here's what I found{' for you' if not client_name else f' for {client_name}'}."
    lines.append(greeting)

    stops = [(pillar, results[0]) for pillar, results in itinerary.items() if results]

    if not stops:
        return "I'm sorry, I couldn't find available resources nearby right now. Please call 211 for help."

    for i, (pillar, r) in enumerate(stops, 1):
        walk = int(r["distance_walk_min"])
        transit = "There's a TTC stop nearby." if r["transit_accessible"] else ""
        line = f"Stop {i}: {r['name']}, for {pillar}. "
        line += f"About a {walk} minute walk, at {r['address']}. {transit}"
        if r.get("intake_preparation"):
            line += f" When you arrive: {r['intake_preparation']}"
        elif r.get("bypass_pathway") and not r.get("accessible", True):
            line += f" Note: {r['bypass_pathway']}"
        lines.append(line)

    lines.append("Good luck. You can ask me again any time.")
    return " ".join(lines)


def _cleanup_expired():
    now = time.time()
    expired = [sid for sid, s in _sessions.items()
               if now - s.created_at > VOICE_SESSION_IDLE_SEC]
    for sid in expired:
        del _sessions[sid]
```

---

### 9.6 `main.py` (FastAPI)

```python
"""
main.py
FastAPI application. All routes. Swagger at /docs.
Launch: uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from contextlib import asynccontextmanager

from config import EngineMode, KIOSK_HUBS
from data_ingestion import load_all
from nim_compiler import (compile_needs, generate_briefing, generate_handoff_script,
                           kiosk_voice_payload, NeedsPayload)
from solver import solve
from voice_session import (create_session, get_session, resolve_eligibility_questions,
                            parse_eligibility_answer, clean_transcript, build_tts_itinerary_script)

datasets_gpu = {}
datasets_cpu = {}
_last_benchmark = {"gpu_ms": None, "cpu_ms": None}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global datasets_gpu, datasets_cpu
    print("Loading datasets into GPU memory...")
    datasets_gpu, _ = load_all(EngineMode.GPU)
    datasets_cpu, _ = load_all(EngineMode.CPU)
    print("Ready.")
    yield


app = FastAPI(
    title="Haven Matrix API",
    description="Dual-gateway social services triage. GPU-accelerated. Offline-resilient.",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class CaseworkerRouteRequest(BaseModel):
    text: str
    origin_lat: float = 43.6532
    origin_lon: float = -79.3832
    client_name: str | None = None

class KioskSessionRequest(BaseModel):
    transcript: str
    origin_lat: float
    origin_lon: float

class KioskRouteRequest(BaseModel):
    session_id: str
    eligibility_answers: dict

class BriefingRequest(BaseModel):
    current_time_iso: str

class HandoffRequest(BaseModel):
    facility_name: str
    facility_phone: str
    payload: NeedsPayload


@app.get("/api/v1/health")
async def health():
    return {
        "status": "ok",
        "datasets": {k: len(v) for k, v in datasets_gpu.items()},
        "total_records": sum(len(v) for v in datasets_gpu.values()),
    }


@app.get("/api/v1/benchmark")
async def benchmark():
    gpu = _last_benchmark["gpu_ms"]
    cpu = _last_benchmark["cpu_ms"]
    return {
        "last_gpu_ms": gpu,
        "last_cpu_ms": cpu,
        "speedup": round(cpu / gpu, 1) if gpu else None,
    }


@app.post("/api/v1/caseworker/route")
async def caseworker_route(req: CaseworkerRouteRequest):
    try:
        cleaned = clean_transcript(req.text)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    payload, method, nim_ms = compile_needs(cleaned)
    origin = (req.origin_lat, req.origin_lon)

    itinerary_gpu, gpu_ms = solve(payload, datasets_gpu, origin, EngineMode.GPU)
    # Run CPU benchmark in a thread to avoid blocking the async event loop.
    # Use run_in_executor so FastAPI stays responsive during the CPU solve.
    import asyncio
    loop = asyncio.get_event_loop()
    itinerary_cpu, cpu_ms = await loop.run_in_executor(
        None, solve, payload, datasets_cpu, origin, EngineMode.CPU
    )
    _last_benchmark.update({"gpu_ms": gpu_ms, "cpu_ms": cpu_ms})

    return {
        "payload":            payload.dict(),
        "compile_method":     method,
        "nim_latency_ms":     round(nim_ms, 1),
        "gpu_solve_ms":       round(gpu_ms, 2),
        "cpu_solve_ms":       round(cpu_ms, 2),
        "speedup":            round(cpu_ms / gpu_ms, 1) if gpu_ms > 0 else None,
        "itinerary":          itinerary_gpu,
        "ticket_text":        build_tts_itinerary_script(itinerary_gpu, req.client_name),
        "eligibility_questions": [],
    }


@app.post("/api/v1/kiosk/session")
async def kiosk_session(req: KioskSessionRequest):
    try:
        cleaned = clean_transcript(req.transcript)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    payload, _, _ = compile_needs(cleaned)
    session = create_session(payload, (req.origin_lat, req.origin_lon))
    questions = resolve_eligibility_questions(payload)

    return {
        "session_id":            session.session_id,
        "payload_draft":         payload.dict(),
        "eligibility_questions": questions,
        "next_step":             "collect_eligibility" if questions else "route",
    }


@app.post("/api/v1/kiosk/route")
async def kiosk_route(req: KioskRouteRequest):
    session = get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session expired or not found")

    draft = session.payload_draft.dict()
    draft.update({k: v for k, v in req.eligibility_answers.items() if v is not None})
    payload = NeedsPayload(**draft)

    itinerary, gpu_ms = solve(payload, datasets_gpu, session.origin, EngineMode.GPU)
    _, cpu_ms          = solve(payload, datasets_cpu, session.origin, EngineMode.CPU)
    _last_benchmark.update({"gpu_ms": gpu_ms, "cpu_ms": cpu_ms})

    return {
        "itinerary":    itinerary,
        "tts_script":   build_tts_itinerary_script(itinerary),
        "gpu_solve_ms": round(gpu_ms, 2),
    }


@app.post("/api/v1/caseworker/briefing")
async def caseworker_briefing(req: BriefingRequest):
    shelters = datasets_gpu.get("shelters")
    if shelters is None:
        raise HTTPException(status_code=503, detail="Shelter data not loaded")
    try:
        total     = int(shelters["CAPACITY_ACTUAL_BED"].sum())
        available = int(shelters["UNOCCUPIED_BEDS"].sum())
        by_sector = shelters.groupby("SECTOR")["UNOCCUPIED_BEDS"].sum().to_pandas().to_dict()
        summary   = (f"Total beds: {total}. Available: {available}. "
                     f"By sector: {by_sector}. Current time: {req.current_time_iso}.")
    except Exception as e:
        summary = f"Shelter data summary unavailable: {e}"

    briefing = generate_briefing(summary)
    return {"briefing_text": briefing}


@app.post("/api/v1/handoff-script")
async def handoff_script(req: HandoffRequest):
    script = generate_handoff_script(req.facility_name, req.payload)
    return {"script": script, "facility": req.facility_name}
```

---

### 9.7 Frontend — Node.js + React

The frontend is a standard Vite + React + TypeScript project. Key implementation notes:

#### `src/api/client.ts`

```typescript
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8000/api/v1',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

export default api;
```

#### `src/components/GatewayB/VoiceOrb.tsx`

The VoiceOrb is the only interactive element on the kiosk screen. It is the button — full screen tap target. Four states with CSS animations:

- **idle**: slow pulse, grey — "Hold to speak"
- **listening**: fast pulse, red — "Listening..."
- **processing**: spinner, blue — "Finding help..."
- **speaking**: gentle wave, green — "Here's what I found..."

The orb is implemented as a large `div` with `onPointerDown` / `onPointerUp` handlers driving the `useSpeech` hook. No `<button>` element — the entire element is the affordance.

#### `src/components/GatewayA/PayloadConfirm.tsx`

Shows five toggle switches after NIM compilation:

```
☑ Needs a bed tonight
☑ Needs detox or mental health support
☑ Needs food
☐ Needs clothing or supplies
☐ Needs shower or hygiene
Sector: [Adult ▾]
```

Caseworker can correct misparses in one click before the solver runs. Auto-submits after 5 seconds of no interaction (configurable via `config.py`).

#### `src/components/shared/BenchmarkPanel.tsx`

Sidebar panel showing live GPU ms, CPU ms, and speedup multiplier fetched from `GET /api/v1/benchmark` after each route request. This is visible to judges during the demo.

---

## 10. JSON Schema Contract

Single source of truth — shared between `nim_compiler.py` (Pydantic), `solver.py` (mask logic), `main.py` (FastAPI models), and React frontend (TypeScript interface).

```json
{
  "needs_shelter":   true,
  "needs_rehab":     false,
  "needs_food":      true,
  "needs_supplies":  false,
  "needs_hygiene":   false,
  "sector":          "adult",
  "has_id":          false,
  "sobriety_status": "using",
  "group_size":      "alone"
}
```

| Field | Type | Values | Source |
|---|---|---|---|
| `needs_shelter` | bool | `true/false` | NIM / regex / kiosk voice |
| `needs_rehab` | bool | `true/false` | NIM / regex / kiosk voice |
| `needs_food` | bool | `true/false` | NIM / regex / kiosk voice |
| `needs_supplies` | bool | `true/false` | NIM / regex / kiosk voice |
| `needs_hygiene` | bool | `true/false` | NIM / regex / kiosk voice |
| `sector` | string | `youth/adult/family/any` | NIM / regex, default `"any"` |
| `has_id` | bool or null | `true/false/null` | Eligibility question or NIM |
| `sobriety_status` | string or null | `sober/using/null` | Eligibility question or NIM |
| `group_size` | string or null | `alone/with_family/null` | Eligibility question or NIM |

**TypeScript interface**:

```typescript
interface NeedsPayload {
  needs_shelter:   boolean;
  needs_rehab:     boolean;
  needs_food:      boolean;
  needs_supplies:  boolean;
  needs_hygiene:   boolean;
  sector:          'youth' | 'adult' | 'family' | 'any';
  has_id:          boolean | null;
  sobriety_status: 'sober' | 'using' | null;
  group_size:      'alone' | 'with_family' | null;
}
```

---

## 11. Functional Requirements

| ID | Requirement | Implementation | Files |
|---|---|---|---|
| **FR-1** | Dual-gateway UI | React app with `/caseworker` and `/kiosk` routes | `App.tsx`, `CaseworkerPage.tsx`, `KioskPage.tsx` |
| **FR-2** | Voice input — Gateway A (caseworker) | Push-to-talk with text area fallback. `continuous=false`, `interimResults=true`. 60s session timer. Space bar shortcut. | `useSpeech.ts`, `VoiceInput.tsx` |
| **FR-3** | Voice input — Gateway B (kiosk) | Push-to-talk via VoiceOrb ONLY. No text fallback. No other buttons. Non-streaming MediaRecorder buffer. 45s hard cap. Auto-kill on 10s silence. | `useSpeech.ts`, `VoiceOrb.tsx`, `KioskPage.tsx` |
| **FR-4** | TTS output — both gateways | `speechSynthesis` reads itinerary, eligibility questions, errors. `useSpeech.speak()` shared hook. | `useSpeech.ts` |
| **FR-5** | Local NIM semantic extraction | Nemotron/Llama via llama.cpp or NIM. Pydantic validation. 2-retry. | `nim_compiler.py` |
| **FR-6** | Zero-copy data ingestion | `cudf.read_csv()` → unified GPU memory. `EngineMode` enum. | `data_ingestion.py` |
| **FR-7** | Constraint-aware routing | cuDF masks filter by `has_id`, `sobriety_status`, `group_size` before KNN. | `solver.py` |
| **FR-8** | Capacity + congestion balancing | Composite score: 60% distance + 30% occupancy + 10% transit. | `solver.py` |
| **FR-9** | CPU vs GPU benchmark panel | Both pipelines run per request. `GET /api/v1/benchmark`. `BenchmarkPanel.tsx`. | `solver.py`, `main.py`, `BenchmarkPanel.tsx` |
| **FR-10** | Eligibility question flow | Backend resolves ≤3 spoken questions. Kiosk asks via TTS, captures via push-to-talk. | `voice_session.py`, `EligibilityFlow.tsx` |
| **FR-11** | Intake preparation text | Each result includes plain-language "what to expect" from `intake_preparation` CSV column. | `solver.py`, `Itinerary.tsx` |
| **FR-12** | Warm handoff script | Second NIM call per facility for phone script. "Generate Script" button in Gateway A. | `nim_compiler.py`, `HandoffScript.tsx` |
| **FR-13** | Morning shift briefing | One NIM call summarizing fresh shelter data. Gateway A only. | `nim_compiler.py`, `ShiftBriefing.tsx` |
| **FR-14** | Outbound ticket | Copyable text ticket with optional client name. | `voice_session.py`, `Ticket.tsx` |
| **FR-15** | Offline resilience fallback | Regex if NIM offline. Pandas if GPU offline. CSV cache if CKAN offline. | `nim_compiler.py`, `data_ingestion.py` |
| **FR-16** | Swagger API testing | FastAPI `/docs` for teammate testing without frontend. | `main.py` |

---

## 12. Non-Functional Requirements

| ID | Requirement | Target | How |
|---|---|---|---|
| **NFR-1** | GPU spatial solve | < 10 ms | cuML NearestNeighbors on pre-loaded masked arrays. Benchmark panel displays it. |
| **NFR-2** | Fully offline after startup | Zero remote calls during demo | All data pre-cached. LLM local. Voice browser-native. CKAN fetch at startup only. |
| **NFR-3** | Kiosk accessibility | Voice-only, dark theme, high contrast | No buttons except VoiceOrb. Large TTS-synced text. WCAG AA color contrast. |
| **NFR-4** | Voice session privacy | No audio leaves device | Only text transcript sent to local FastAPI. No cloud STT. No audio stored. |
| **NFR-5** | Session auto-cleanup | No stale data | `_cleanup_expired()` runs on each session lookup. |
| **NFR-6** | API testability | All endpoints in Swagger | FastAPI auto-generates `/docs` from Pydantic models. |

---

## 13. GX10 Setup — Step-by-Step

```bash
# Step 1 — Verify hardware
nvidia-smi && uname -m   # must show GB10 and aarch64

# Step 2 — Pull RAPIDS container (start immediately at check-in)
docker pull rapidsai/base:25.06-cuda12-py3.12

# Step 3 — Download Nemotron weights (~38 GB — start early, can resume)
pip install huggingface-hub
huggingface-cli download ggml-org/NVIDIA-Nemotron-3-Nano-Omni \
  nemotron-3-nano-omni-ga_v1.0-Q8_0.gguf --local-dir ~/models/nemotron

# Step 4 — Build llama.cpp with CUDA
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp && cmake -B build -DGGML_CUDA=ON && cmake --build build -j$(nproc)

# Step 5 — Start Nemotron server (keep terminal open)
./build/bin/llama-server \
  --model ~/models/nemotron/nemotron-3-nano-omni-ga_v1.0-Q8_0.gguf \
  --host 0.0.0.0 --port 30000 --n-gpu-layers 99 --ctx-size 8192 --threads 8

# Step 6 — Test endpoint
curl http://localhost:30000/v1/chat/completions -H "Content-Type: application/json" \
  -d '{"model":"nemotron","messages":[{"role":"user","content":"Reply: {\"test\":true}"}]}'

# Step 7 — Start RAPIDS container with backend mounted
cd ~/ProjectHaven
docker run --gpus all --network host -v $(pwd):/app -w /app \
  -it rapidsai/base:25.06-cuda12-py3.12 bash

# Step 8 — Inside container: install deps
pip install fastapi uvicorn pydantic openai gtfs-kit requests

# Step 9 — Verify RAPIDS
python -c "import cudf; import cuml; print('RAPIDS OK', cudf.__version__)"

# Step 10 — Verify data + benchmark
python backend/data_ingestion.py --verify
python backend/solver.py --benchmark

# Step 11 — Start FastAPI (inside container)
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
# Swagger: http://localhost:8000/docs

# Step 12 — Start React frontend (host OS, new terminal)
cd frontend && npm install && npm run dev
# Frontend: http://localhost:3000

# Step 13 — nvidia-smi for demo recording
watch -n 1 nvidia-smi
```

---

## 14. Sprint Timeline

| Time | Phase | Who | Deliverable |
|---|---|---|---|
| **May 29, 5–9 PM** | Setup | All | GX10 running, containers pulled, model downloading, CKAN CSVs cached, OSM pre-fetched, schema committed, `npm install` done |
| **May 29, 9 PM – 3 AM** | Phase 1 — Data contract | Eng 1: cuDF ingestion + KNN skeleton. Eng 2: llama.cpp + first JSON. Eng 3: FastAPI shell + React both routes rendering. TPM: audit CSV columns, compile mock CSVs | 7 files load. NIM returns JSON. `/health` 200. React renders. |
| **May 30, 3–9 AM** | Phase 2 — Core logic | Eng 1: eligibility-aware masks + congestion balancer. Eng 2: NIM prompts (triage + briefing + handoff) + regex fallback. Eng 3: `useSpeech.ts` push-to-talk + voice session state machine. TPM: finish rehab + grassroots CSVs with bypass_pathway | NIM valid JSON. Masks filter by has_id + sobriety. Voice transcript visible in both UIs. |
| **May 30, 9:30 AM – 6:30 PM** | Phase 3 — Integration | All: end-to-end both gateways. Eligibility flow. TTS readback. Benchmark panel. Handoff script. Swagger tested by TPM | Both gateways fully functional. TTS speaks route. Speedup number visible. |
| **May 30, 6:30 PM** | Organizer check-in | All | Demo Gateway B voice flow. GPU ms. Spark Story ready. |
| **May 30, 7 PM – overnight** | Phase 4 — Lockdown | All | Code freeze. Demo video. Kiosk dark theme + VoiceOrb polish. README. |
| **May 31, 9–10:30 AM** | Finalize | All | Bug fixes only. Submit by 10:30 AM. |
| **May 31, 11 AM** | Submission deadline | — | — |
| **May 31, 12–2:30 PM** | Judging | All | Lead with Gateway B voice demo. Benchmark panel. Eligibility flow. Handoff script. Spark Story. |

---

## 15. Rubric Coverage Map

| Criterion | Points | How We Score It |
|---|---|---|
| **Completeness** | 15 | FR-15 fallback (regex + pandas) means no crash. Gateway B voice is independent of NIM. `/api/v1/health` proves pipeline health live to judges. |
| **Technical Depth** | 15 | 9-stage pipeline: voice STT → transcript clean → NIM compiler → Pydantic → constraint-aware cuDF mask → cuML KNN → congestion balancer → GTFS join → TTS readback. Plus eligibility question flow, handoff script, shift briefing — all via local LLM. |
| **NVIDIA Stack** | 15 | cuDF + cuML + NIM (Llama) + Nemotron (llama.cpp). Four NVIDIA libraries used explicitly. FastAPI backend demonstrates production-grade NVIDIA integration. |
| **Spark Story** | 15 | 128 GB unified memory holds Nemotron (38 GB) + 7 data matrices + LLM context simultaneously. Zero PCIe transfer. Sub-10ms 5-pillar KNN. Benchmark panel makes this a measured fact, not a claim. |
| **Performance** | 10 | FR-9 benchmark panel: live GPU ms vs CPU ms + speedup. `GET /api/v1/benchmark`. Quotable number stated explicitly during judging. |
| **Usability** | 10 | Voice-only kiosk — no literacy required. Constraint-aware routing — only shows resources you can actually enter. Intake preparation text — tells person what to say at the door. Handoff script — caseworker phone call written for them. |
| **Creativity** | 10 | LLM-as-deterministic-compiler. Eligibility-aware routing bypassing real access barriers. Warm handoff scripts. Full voice-to-route-to-speech local pipeline. |
| **Insight Quality** | 10 | Not nearest shelter — nearest shelter you can actually walk into now. Plus bypass pathways when no accessible option exists in current eligibility state. |
| **Total** | **100** | **Projected: 90–98 / 100** |

---

## 16. The Spark Story — Memorize This

Every team member should be able to deliver this without notes.

> "Haven Matrix holds all seven data matrices — shelter occupancy, clinical services, food programs, hygiene stations, grassroots resources, public amenities, and 9,255 TTC stops — plus the full Nemotron-30B language model context, simultaneously in the DGX Spark's 128 gigabytes of unified memory.
>
> On any other hardware, you'd be serializing data through a PCIe bottleneck between CPU RAM and GPU VRAM. Here, everything lives in one coherent memory space. When someone speaks to the kiosk, their words become a boolean payload in milliseconds, and cuML solves the nearest accessible resources across all five pillars simultaneously in under ten milliseconds — accounting for whether they have ID, whether they're currently using, whether they have family with them.
>
> That number on the benchmark panel — that's not a claim. That's a measurement from this hardware, right now."

---

## 17. Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| Nemotron download too slow | High | Start at 5 PM check-in. Have Llama 3.1 8B NIM as fallback — same OpenAI API, zero code change. |
| llama.cpp CUDA build fails | High | Pre-build on ARM64 machine. Fallback: NIM container for Llama 3.1 8B. |
| Community services CSV missing columns | High | TPM audits at 9 PM Day 1. Derive boolean flags from service_type. This unblocks Eng 1. |
| webkitSpeechRecognition fails in browser | High | Test at 9 PM immediately. Grant mic permission in Chrome. If STT fails: Gateway A falls back to text. Gateway B emergency fallback: 3 large buttons (shelter/food/hygiene). |
| NIM produces malformed JSON | Medium | Pydantic catches it. 2-retry wrapper. Regex fallback handles full NIM outage. |
| Eligibility yes/no answers misparse | Medium | "Say yes or no" embedded in question text constrains expected vocabulary. Keyword matching is robust. |
| React + FastAPI CORS issues | Medium | `CORSMiddleware` in `main.py`. Test `GET /health` from browser in Phase 1 — fix immediately. |
| cuDF/cuML not in container | Medium | Verify Step 9 immediately. Try `rapidsai/base:latest` if tag mismatch. |
| CPU benchmark adds UX latency | Low | Run CPU solve in background thread. Cache last result. Show stale number if not ready. |
| CKAN API down at demo | Low | Local CSV cache. Banner: "Using cached data from [date]." Judges understand. |

---

## 18. Pre-Event Checklist

### Before 5 PM today (May 29)

**Data**
- [ ] Download `shelters.csv` from Toronto CKAN → `data/shelters.csv`
- [ ] Download community services CSV → audit columns → `data/hygiene_stations.csv` + `data/food_banks.csv`
- [ ] Download Ontario Open Data mental health org CSV (reference for `rehab_services.csv`)
- [ ] Extract TTC GTFS `stops.txt` → `data/stops.txt`
- [ ] Pre-fetch OSM Toronto bbox → `data/osm_amenities.json` (Overpass query in §5)
- [ ] Begin hand-compiling `data/rehab_services.csv` — include `bypass_pathway` + `intake_preparation` columns
- [ ] Begin hand-compiling `data/grassroots_services.csv` — 211.ca + Daily Bread + Drop-In Network

**Infrastructure**
- [ ] Pull `rapidsai/base:25.06-cuda12-py3.12` to USB / local cache
- [ ] Download Nemotron GGUF or Llama 3.1 8B weights
- [ ] `npm install` in `frontend/` — verify React dev server starts on port 3000
- [ ] Decide: Nemotron (bounty) or Llama 3.1 8B (safer) → set `NIM_MODEL` in `config.py`

**Team alignment**
- [ ] Commit JSON schema + TypeScript interface to repo — all teammates agree
- [ ] Set up `ProjectHaven/` directory structure with placeholder files
- [ ] Join Spark Hack Discord → introduce team

### Phase 1 Gate (by ~3 AM May 30)

- [ ] `python backend/data_ingestion.py --verify` — all 7 files, no errors
- [ ] llama.cpp / NIM server returning valid JSON to `curl` test
- [ ] `GET /api/v1/health` returns 200 with dataset row counts in Swagger
- [ ] React: `/caseworker` and `/kiosk` routes both render
- [ ] `useSpeech.ts`: push-to-talk working in Chrome, transcript visible in UI
- [ ] `config.py`: all 5 kiosk hub coordinates + all timeout constants

### Phase 2 Gate (by ~9 AM May 30)

- [ ] NIM → valid JSON for 5+ test cases including adversarial inputs
- [ ] Regex fallback compiles when NIM URL set to invalid endpoint
- [ ] cuDF masks filter by `has_id=False` and `sobriety_status="using"` correctly
- [ ] Eligibility questions resolve for shelter + rehab needs
- [ ] `rehab_services.csv` and `grassroots_services.csv` complete with `bypass_pathway` column
- [ ] TTS speaks eligibility questions aloud in Gateway B

### Phase 3 Gate (by 6:30 PM May 30)

- [ ] Gateway A: text → NIM → payload confirm toggles → itinerary → handoff script
- [ ] Gateway B: voice → eligibility flow (TTS questions) → route → TTS reads itinerary
- [ ] `GET /api/v1/benchmark` showing real GPU and CPU ms
- [ ] TTC transit proximity flag in results
- [ ] Ticket text copyable from Gateway A with optional client name field
- [ ] All Swagger endpoints tested by a teammate who didn't write the backend

### Phase 4 Gate (by 10:30 AM May 31)

- [ ] Demo video recorded — 3-5 min, nvidia-smi split screen, both gateway flows
- [ ] Kiosk: dark theme, large text, VoiceOrb animations, voice-only (no other buttons visible)
- [ ] Caseworker: shift briefing works, handoff script generates for ≥1 facility
- [ ] `README.md` complete with setup commands and Spark Story
- [ ] `python backend/solver.py --benchmark` produces GPU and CPU ms
- [ ] Submitted before **10:30 AM**
- [ ] All team members can recite the Spark Story without notes

---

*Document version: 2.1 — Added: §4A missing file specs (package.json, vite.config.ts, frontend/src/config.ts, types/api.ts, App.tsx routing, EligibilityFlow.tsx spec, backend/requirements.txt, docker-compose.yml), kiosk location resolution strategy, intake_preparation column in datasets 3+4, async CPU benchmark fix in main.py, stray import removed from solver.py, accessible field design note clarified, duplicate keyword removed from parse_eligibility_answer*

*Start with: `config.py` → `data_ingestion.py` → `nim_compiler.py` → `solver.py` → `voice_session.py` → `main.py` → frontend*
