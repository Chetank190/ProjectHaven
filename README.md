# Haven Matrix

**NVIDIA Spark Hack Toronto · May 29–31 · Public Services Track**

## The Spark Story

> "Haven Matrix holds all seven data matrices — shelter occupancy, clinical services, food programs, hygiene stations, grassroots resources, public amenities, and 9,255 TTC stops — plus the full Nemotron-30B language model context, simultaneously in the DGX Spark's 128 gigabytes of unified memory.
>
> On any other hardware, you'd be serializing data through a PCIe bottleneck between CPU RAM and GPU VRAM. Here, everything lives in one coherent memory space. When someone speaks to the kiosk, their words become a boolean payload in milliseconds, and cuML solves the nearest accessible resources across all five pillars simultaneously in under ten milliseconds — accounting for whether they have ID, whether they're currently using, whether they have family with them.
>
> That number on the benchmark panel — that's not a claim. That's a measurement from this hardware, right now."

---

## What It Does

Haven Matrix is a dual-gateway triage system for social services in Toronto:

- **Gateway A (Caseworker)** — Type or speak client notes → NIM compiles to JSON → constraint-aware GPU KNN → per-client itinerary + warm handoff phone scripts
- **Gateway B (Kiosk)** — Voice only → eligibility questions via TTS → spoken care route to resources you can actually enter given your ID status, sobriety, and family situation

---

## Quick Start (Local / MacBook)

```bash
# 1. Install Python dependencies
pip install -r backend/requirements.txt

# 2. Verify datasets
python backend/data_ingestion.py --verify --mode cpu

# 3. Start FastAPI (port 8000)
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# 4. In a new terminal — start React (port 3000)
cd frontend && npm install && npm run dev

# 5. Open browser
# Caseworker: http://localhost:3000/caseworker
# Kiosk:      http://localhost:3000/kiosk  (requires Chrome for voice)
# Swagger:    http://localhost:8000/docs
```

**NIM/LLM is optional for local dev.** The system falls back to regex keyword matching automatically when LLM endpoints are unreachable.

---

## GX10 Setup (NVIDIA Grace Blackwell)

```bash
# Step 1 — Verify hardware
nvidia-smi && uname -m   # must show GB10 and aarch64

# Step 2 — Pull RAPIDS container (start at check-in — large image)
docker pull rapidsai/base:25.06-cuda12-py3.12

# Step 3 — Download Nemotron weights (~38 GB)
pip install huggingface-hub
huggingface-cli download ggml-org/NVIDIA-Nemotron-3-Nano-Omni \
  nemotron-3-nano-omni-ga_v1.0-Q8_0.gguf --local-dir ~/models/nemotron

# Step 4 — Build llama.cpp with CUDA
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp && cmake -B build -DGGML_CUDA=ON && cmake --build build -j$(nproc)

# Step 5 — Start Nemotron on port 30000
./build/bin/llama-server \
  --model ~/models/nemotron/nemotron-3-nano-omni-ga_v1.0-Q8_0.gguf \
  --host 0.0.0.0 --port 30000 --n-gpu-layers 99 --ctx-size 8192

# Step 6 — Start RAPIDS container with project mounted
cd ~/ProjectHaven
docker run --gpus all --network host -v $(pwd):/app -w /app \
  -it rapidsai/base:25.06-cuda12-py3.12 bash

# Step 7 — Inside container
pip install -r backend/requirements.txt
python -c "import cudf, cuml; print('RAPIDS OK')"
python backend/data_ingestion.py --verify --mode gpu
python backend/solver.py --benchmark

# Step 8 — Start FastAPI (inside container)
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Step 9 — On host OS, start React
cd frontend && npm run dev
```

---

## Architecture

```
Caseworker (React :3000/caseworker)    Kiosk (React :3000/kiosk)
         │ HTTP POST via Vite proxy              │
         ▼                                       ▼
         FastAPI :8000
         ├── NIM Compiler (Nemotron :30000 → regex fallback)
         └── RAPIDS Solver
             ├── cuDF: 7 datasets (290 shelters, 25 rehab,
             │         20 food, 15 hygiene, 20 grassroots,
             │         55 OSM, 9,369 TTC stops)
             └── cuML: NearestNeighbors KNN (haversine, <10ms)
                  └── Constraint masking: has_id, sobriety, group
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/caseworker/route` | Text → payload → itinerary + handoff scripts |
| POST | `/api/v1/kiosk/session` | Voice transcript → session + eligibility questions |
| POST | `/api/v1/kiosk/route` | Session + eligibility answers → spoken itinerary |
| POST | `/api/v1/caseworker/briefing` | Morning shelter capacity summary |
| POST | `/api/v1/handoff-script` | Generate caseworker phone call script |
| GET | `/api/v1/health` | Dataset row counts + rapids_mode |
| GET | `/api/v1/benchmark` | Last GPU ms, CPU ms, speedup ratio |

---

## Fallback Chain

| Component | Primary | Fallback |
|-----------|---------|----------|
| LLM | Nemotron (llama.cpp :30000) | Llama 3.1 8B (NIM :8001) → regex |
| Data engine | cuDF + cuML (GPU) | pandas + scikit-learn (CPU) |
| Shelter data | Toronto CKAN (live) | Cached `data/shelters.csv` |

---

## Environment Variables

```bash
# .env (never commit)
NGC_API_KEY=your_ngc_key_here

# Optional
NIM_ENDPOINT=http://localhost:30000/v1   # llama.cpp Nemotron
VITE_KIOSK_HUB=Union Station            # Pre-configure kiosk location
```

---

## Composite Scoring

```
score = 0.60 × dist_norm + 0.30 × occupancy_ratio + 0.10 × (0 if transit else 1)
```
Lower score = better match. Balanced between proximity, availability, and transit access.
