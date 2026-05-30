# Haven Matrix — CLAUDE.md

## What This Is

Haven Matrix is a dual-gateway, GPU-accelerated social services triage system for the NVIDIA Spark Hack Toronto hackathon. It routes unhoused people and caseworkers to accessible social services in Toronto using local LLM inference and cuML KNN on the GX10's 128 GB unified memory.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                         │
│  Gateway A (Caseworker)    |  Gateway B (Kiosk — voice only) │
│  React :3000/caseworker    |  React :3000/kiosk              │
└──────────────────────────────────────────────────────────────┘
                          ↓ HTTP POST (Vite proxy)
┌──────────────────────────────────────────────────────────────┐
│              FastAPI BACKEND  (port 8000)                     │
│  POST /api/v1/caseworker/route                               │
│  POST /api/v1/kiosk/session + /kiosk/route                   │
│  POST /api/v1/caseworker/briefing                            │
│  POST /api/v1/handoff-script                                 │
│  GET  /api/v1/benchmark  |  GET /api/v1/health               │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│     LLM INFERENCE (Nemotron-30B or Llama 3.1 8B)             │
│     llama.cpp :30000  OR  NIM container :8000/v1             │
│     Fallback: regex keyword extractor                        │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│     GPU DATA (RAPIDS — 128 GB unified memory)                 │
│     cuDF: 7 datasets (shelters, rehab, food, hygiene,        │
│           grassroots, OSM, TTC stops)                        │
│     cuML: NearestNeighbors KNN (haversine, < 10ms)           │
│     Constraint masking: has_id, sobriety_status, group_size  │
└──────────────────────────────────────────────────────────────┘
```

## Key Backend Modules

| File | Role |
|------|------|
| `backend/config.py` | All constants: endpoints, paths, prompts, weights. No logic. |
| `backend/data_ingestion.py` | Loads 7 datasets into GPU (cuDF) or CPU (pandas). CKAN fetch with cache fallback. |
| `backend/nim_compiler.py` | LLM client → NeedsPayload JSON. Regex fallback if LLM offline. |
| `backend/solver.py` | cuML KNN with constraint-aware masking + composite scoring. CPU benchmark. |
| `backend/voice_session.py` | Session management, eligibility questions, transcript cleaning, TTS script builder. |
| `backend/main.py` | FastAPI app, all 7 endpoints, lifespan GPU/CPU load. |

## Key Commands

```bash
# Run backend (local dev — CPU mode, no GPU needed)
pip install -r backend/requirements.txt
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Verify data loads
python backend/data_ingestion.py --verify --mode cpu

# Run benchmark (GPU vs CPU)
python backend/solver.py --benchmark

# Run frontend
cd frontend && npm install && npm run dev

# Swagger UI
open http://localhost:8000/docs

# GX10 (inside RAPIDS container)
docker run --gpus all --network host -v $(pwd):/app -w /app \
  -it rapidsai/base:25.06-cuda12-py3.12 bash
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NIM_ENDPOINT` | `http://localhost:30000/v1` | llama.cpp Nemotron server |
| `NIM_FALLBACK` | `http://localhost:8000/v1` | NIM container fallback |
| `NGC_API_KEY` | — | NVIDIA NGC key (for NIM container) |
| `VITE_KIOSK_HUB` | `Union Station` | Pre-configured kiosk location |

## Core Design Principle

**LLM as deterministic compiler, not decision-maker.** Every LLM call has:
1. A deterministic equivalent (regex fallback)
2. A strict JSON output schema (Pydantic validation)
3. A fallback path (regex if NIM offline, pandas if GPU offline)

## Hard Boundaries

- No audio ever leaves the device — transcript only, never audio blob
- No cloud STT — Web Speech API is browser-native
- No live API calls during demo — all data pre-cached
- Kiosk (Gateway B) is voice-only — no keyboard inputs, no text boxes
