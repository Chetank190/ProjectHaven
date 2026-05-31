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

# 5. In a new terminal — start React (port 3001)
cd frontend && npm install && npm run dev

# 6. Open browser
# Caseworker: http://localhost:3001/caseworker
# Kiosk:      http://localhost:3001/kiosk  (requires Chrome for voice)
# Swagger:    http://localhost:8000/docs
```

**NIM/LLM is optional for local dev.** Without a GX10 connection, the system falls back to regex keyword matching automatically.

> **Mac + GX10 setup (team default):** backend and frontend on Mac; models on GX10 GPU only → [`learning/gx10_access_and_gpu_guide.md`](learning/gx10_access_and_gpu_guide.md)

---

## Development Architecture (Mac + GX10)

**Default:** run **backend + frontend on your Mac**; run **models only on the GX10 GPU** over Tailscale.

```
Mac (:3001 frontend, :8000 backend CPU)
    │  NIM_ENDPOINT=http://100.81.85.39:8001/v1
    ▼  Tailscale
GX10 — docker compose up nim -d  (Gemma 3n on GPU :8001)
       optional: docker compose up asr -d  (Parakeet on GPU :9000)
```

| Step | Where | Command |
|------|-------|---------|
| 1. Load model on GPU | GX10 (SSH) | `docker compose up nim -d` |
| 2. Backend | Mac | `uvicorn backend.main:app --port 8000 --reload` |
| 3. Frontend | Mac | `cd frontend && npm run dev` |

Mac `.env` (copy from `.env.example`):

```bash
GX10_TAILSCALE_IP=100.81.85.39          # your unit's Tailscale IP
FORCE_CPU_SOLVER=1
NIM_ENDPOINT=http://100.81.85.39:8001/v1
NIM_FALLBACK=http://100.81.85.39:8001/v1
```

**Model storage:** weights download automatically into Docker volume `nim-cache` on the GX10 on first NIM start (requires `NGC_API_KEY` in GX10 `.env`). Nothing is stored on the Mac.

**Verify:** `compile_method: "nim"` on a route request; `rapids_mode: "cpu"` on `/api/v1/health`.

Full walkthrough: [`learning/gx10_access_and_gpu_guide.md`](learning/gx10_access_and_gpu_guide.md)

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

### Use the UI from your Mac (default — no port-forward needed)

Backend and frontend run locally on the Mac. Only ensure Tailscale is Connected and GX10 NIM is up. Open http://localhost:3001/caseworker.

If `:8001` is unreachable over Tailscale, tunnel the model port:

```bash
ssh -L 8001:localhost:8001 asus@100.81.85.39
# then set NIM_ENDPOINT=http://localhost:8001/v1 in Mac .env
```

---

## GX10 — Models on GPU Only

Backend and frontend run on **your Mac**. The GX10 only hosts **NIM model containers** on GPU.

> Full guide: [`learning/gx10_access_and_gpu_guide.md`](learning/gx10_access_and_gpu_guide.md)

### On the GX10 (SSH)

```bash
cd ~/ProjectHaven
cp .env.example .env          # set NGC_API_KEY from build.nvidia.com
docker compose up nim -d        # LLM only — Gemma 3n on GPU :8001
docker compose logs -f nim      # wait until ready (first run: long download)

# optional ASR on GPU
docker compose up asr -d
```

Verify on GX10:

```bash
curl -s http://localhost:8001/v1/models | head
nvidia-smi
```

**Do not** run `docker compose up` (full stack) unless you also want backend on the box.

### On your Mac

```bash
cp .env.example .env
# set GX10_TAILSCALE_IP and NIM_ENDPOINT=http://<ip>:8001/v1

source .vhaven/bin/activate
set -a && source .env && set +a
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

cd frontend && npm run dev
```

Verify on Mac: `curl localhost:8000/api/v1/health` → `"rapids_mode":"cpu"`; route → `"compile_method":"nim"`.

### Optional — Nemotron or GPU KNN on GX10

See gx10 guide appendix and README legacy options only if benchmarking on-box.

---

## Architecture

```
Mac — React :3001/caseworker | :3001/kiosk
         │ HTTP POST via Vite proxy → localhost:8000
         ▼
Mac — FastAPI :8000 (CPU, FORCE_CPU_SOLVER=1)
         │ HTTP over Tailscale → GX10 :8001
         ▼
GX10 — NIM Gemma 3n :8001 (GPU)  [optional ASR :9000]
         │
         └── Solver on Mac CPU (pandas/sklearn, ~400ms)
              └── 7 datasets + constraint masking
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
| Data engine | cuDF + cuML (GPU) | pandas + scikit-learn (CPU — **GX10 default**) |
| Shelter data | Toronto CKAN (live) | Cached `data/shelters.csv` |

---

## Environment Variables

```bash
# Mac .env — backend + frontend on Mac, models on GX10 (team default)
GX10_TAILSCALE_IP=100.81.85.39
FORCE_CPU_SOLVER=1
NIM_ENDPOINT=http://100.81.85.39:8001/v1
NIM_FALLBACK=http://100.81.85.39:8001/v1
ASR_NIM_URL=http://100.81.85.39:9000
NGC_API_KEY=your_ngc_key_here          # optional cloud LLM/ASR fallback
NIM_API_KEY=not-needed
VITE_KIOSK_HUB=Union Station

# GX10 .env — on the box only (for docker compose up nim)
# NGC_API_KEY=your_ngc_key_here
```

---

## Composite Scoring

```
score = 0.60 × dist_norm + 0.30 × occupancy_ratio + 0.10 × (0 if transit else 1)
```
Lower score = better match. Balanced between proximity, availability, and transit access.
