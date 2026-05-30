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
# 1. Create and activate a virtual environment
python3 -m venv .vhaven
source .vhaven/bin/activate   # Windows: .vhaven\Scripts\activate

# 2. Install Python dependencies
pip install -r backend/requirements.txt

# 3. Verify datasets
python backend/data_ingestion.py --verify --mode cpu

# 4. Start FastAPI (port 8000)
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# 5. In a new terminal — start React (port 3000)
cd frontend && npm install && npm run dev

# 6. Open browser
# Caseworker: http://localhost:3000/caseworker
# Kiosk:      http://localhost:3000/kiosk  (requires Chrome for voice)
# Swagger:    http://localhost:8000/docs
```

**NIM/LLM is optional for local dev.** The system falls back to regex keyword matching automatically when LLM endpoints are unreachable.

> **GX10 access + GPU model setup:** see [`learning/gx10_access_and_gpu_guide.md`](learning/gx10_access_and_gpu_guide.md) (local team doc).

---

## Connecting to the GX10 (No Wi-Fi — SSH Required)

The GX10 has **no built-in Wi-Fi**. Remote access info is on the pamphlet in the box. Connect via **mobile hotspot** first, then optionally **Tailscale** for persistent access.

> Full guide: [`learning/gx10_access_and_gpu_guide.md`](learning/gx10_access_and_gpu_guide.md)

### Step 1 — SSH over mobile hotspot

Connect **your laptop** to the GX10 hotspot (the GX10 auto-connects to saved hotspot profiles):

**Your unit (gx10-3cd8):**
| Field | Value |
|-------|-------|
| Hotspot SSID | `gx10-3cd8` |
| Hotspot Password | `gx10-3cd8` |

Open **Terminal** (Mac/Linux) or **PowerShell as Administrator** (Windows):

```bash
ssh asus@gx10-3cd8.local
```

When prompted:
- Type `yes` and press Enter
- Password: `password`

> **No pamphlet?** Flip the unit over → read the **MAC1** sticker → use the last 4 characters (e.g. `3C:D8` → `gx10-3cd8`). Other units use the same pattern: `ssh asus@gx10-XXXX.local`.

---

### Step 2 — Set up Tailscale (for persistent access across any network)

Install Tailscale on your laptop first: **https://tailscale.com/download**
- Do NOT use a `.edu` email — it blocks registration
- Mac: allow all prompts, enable from the taskbar icon
- Windows: enable from the hidden icon tray (right-click)

Then on the GX10 terminal (Tailscale is pre-installed):

```bash
sudo tailscale up
# Copy the URL it prints → open in your laptop browser → authorize
```

After pairing, SSH via Tailscale from anywhere:

```bash
ssh asus@gx10-3cd8          # by hostname
ssh asus@100.X.X.X          # by Tailscale IP (shown in Tailscale app)
```

**Invite teammates:**
- Team invite link: https://login.tailscale.com/uinv/iC7hHtsfaC215vP2zbheG11
- Or Tailscale admin console → **Invite by email** → teammate joins **Host tailnet**

---

### Step 3 — Venue Wi-Fi + remove hotspot (requires monitor)

The hotspot profile persists across reboots. To switch to venue Wi-Fi, connect a **monitor** to the GX10, pair venue Wi-Fi on the unit, then delete the hotspot profile:

```bash
nmcli con show                        # list all connections
nmcli con delete gx10-3cd8-Hotspot   # delete so it doesn't reconnect on reboot
```

---

### Use the UI from your laptop (SSH port-forward)

```bash
ssh -L 3000:localhost:3000 -L 8000:localhost:8000 asus@gx10-3cd8
```

Then open http://localhost:3000/caseworker on your laptop while services run on the GX10.

---

## GX10 Software Setup (NVIDIA Grace Blackwell)

Two GPU workloads must run for full demo mode: **LLM triage** (Nemotron on :30000 or Gemma NIM on :8001) and **KNN solver** (RAPIDS on :8000).

### Option A — Docker Compose (fastest path to GPU backend + NIM fallback)

```bash
cd ~/ProjectHaven
# Set NGC_API_KEY in .env if using cloud NIM tier
docker compose up
```

Starts Gemma 3n NIM on :8001 and FastAPI + RAPIDS on :8000. Still start Nemotron separately (Option B Step 5) for primary LLM, or point `NIM_ENDPOINT` at :8001.

### Option B — Manual setup (Nemotron + RAPIDS)

```bash
# Step 1 — Verify hardware (run after SSH in)
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

# Step 5 — Start Nemotron on GPU port 30000
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

Verify: `curl http://localhost:8000/api/v1/health` → `rapids_mode: gpu`; route a caseworker request → `compile_method: nim`.

---

## Architecture

```
Caseworker (React :3000/caseworker)    Kiosk (React :3000/kiosk)
         │ HTTP POST via Vite proxy              │
         ▼                                       ▼
         FastAPI :8000
         ├── NIM Compiler (cloud NIM → Nemotron :30000 → Gemma NIM :8001 → regex)
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
| LLM | Cloud NIM Gemma 3n (if `NGC_API_KEY`) → Nemotron (llama.cpp :30000) | Gemma 3n E4B (NIM :8001) → regex |
| Data engine | cuDF + cuML (GPU) | pandas + scikit-learn (CPU) |
| Shelter data | Toronto CKAN (live) | Cached `data/shelters.csv` |

---

## Environment Variables

```bash
# .env (never commit)
NGC_API_KEY=your_ngc_key_here

# LLM endpoints
NIM_ENDPOINT=http://localhost:30000/v1          # llama.cpp Nemotron (GX10 primary)
NIM_FALLBACK=http://localhost:8001/v1          # local NIM Gemma 3n container
NVIDIA_CLOUD_ENDPOINT=https://integrate.api.nvidia.com/v1
NVIDIA_CLOUD_MODEL=google/gemma-3n-e4b-it
NIM_API_KEY=not-needed                         # override if your NIM server requires auth

# Frontend
VITE_KIOSK_HUB=Union Station                   # Pre-configure kiosk location
```

---

## Composite Scoring

```
score = 0.60 × dist_norm + 0.30 × occupancy_ratio + 0.10 × (0 if transit else 1)
```
Lower score = better match. Balanced between proximity, availability, and transit access.
