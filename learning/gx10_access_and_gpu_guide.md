# GX10 Access + GPU Model Setup

> **Start here** for SSH, Tailscale, downloading/storing models on GPU, and connecting from your Mac.
> Companion docs: `haven_matrix_reference.md` (day-of checklist), `haven_matrix_implementation.md` (full spec).

---

## Team architecture (default)

```
┌───────────────────────────── Mac (your laptop) ─────────────────────────────┐
│  React frontend :3000                                                       │
│  FastAPI backend :8000  (CPU — pandas/sklearn, FORCE_CPU_SOLVER=1)         │
│       │ HTTP POST to GX10 over Tailscale                                    │
└───────┼─────────────────────────────────────────────────────────────────────┘
        │
        ▼  Tailscale (e.g. 100.81.85.39)
┌───────────────────────────── GX10 gx10-3cd8 ────────────────────────────────┐
│  Docker NIM Gemma 3n :8001  ── GPU (model download + inference)            │
│  Docker NIM Parakeet ASR :9000  ── GPU (optional)                          │
│  NO backend container · NO frontend on GX10                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

| Where | What runs | GPU? |
|-------|-----------|------|
| **GX10** | `docker compose up nim` (+ optional `asr`) | **Yes** — models only |
| **Mac** | `uvicorn` + `npm run dev` | No — CPU routing + UI |

Model weights are **not** copied to your Mac. They download once on the GX10 into a Docker volume and stay there.

---

## Your unit — gx10-3cd8

| Field | Value |
|-------|-------|
| Hotspot SSID / password | `gx10-3cd8` |
| SSH (hotspot) | `ssh asus@gx10-3cd8.local` |
| SSH (Tailscale) | `ssh asus@100.81.85.39` (check admin console for current IP) |
| Username / password | `asus` / `password` |
| Tailscale invite | https://login.tailscale.com/uinv/iC7hHtsfaC215vP2zbheG11 |

> **No pamphlet?** MAC1 sticker last 4 chars → `gx10-XXXX`.

---

## Step 1 — SSH access

**First time (hotspot):** connect Mac to `gx10-3cd8` → `ssh asus@gx10-3cd8.local`

**Daily (Tailscale):** install/connect Tailscale on Mac (same tailnet as GX10) → `ssh asus@100.81.85.39`

Verify: `ping -c 2 100.81.85.39` should reply before SSH.

See Steps 2–3 below for Tailscale setup details (hotspot pairing, team invite, venue Wi-Fi).

---

## Step 2 — Tailscale (persistent remote access)

1. Install on Mac: https://tailscale.com/download (no `.edu` email)
2. Menu bar → **Connected**
3. On GX10 (once): `sudo tailscale up` → authorize URL in browser
4. Admin → Machines → both **your Mac** and **gx10-3cd8** show Connected

Team invite: https://login.tailscale.com/uinv/iC7hHtsfaC215vP2zbheG11

---

## Step 3 — Download, store, and load models on GPU (GX10 only)

Run these **on the GX10** via SSH. Do **not** run backend or frontend here.

### What gets downloaded and where

| Model | How it installs | Where it is stored | Port |
|-------|-----------------|-------------------|------|
| **Gemma 3n E4B** (LLM) | NIM container pulls from NGC on first start | Docker volume `nim-cache` → `/opt/nim/.cache` in container | **8001** |
| **Parakeet ASR** (optional) | Same pattern | Docker volume `asr-cache` | **9000** |

You do **not** manually `huggingface-cli download` for Gemma — the NIM container handles it when `NGC_API_KEY` is set.

### 3a — Clone repo and set NGC key (on GX10)

```bash
cd ~
git clone https://github.com/Chetank190/ProjectHaven.git   # or your fork
cd ProjectHaven
cp .env.example .env
nano .env   # set NGC_API_KEY from build.nvidia.com → API Keys
```

GX10 `.env` only needs:

```bash
NGC_API_KEY=nvapi-xxxxxxxx
```

### 3b — Start LLM on GPU (required)

```bash
cd ~/ProjectHaven
docker compose up nim -d
docker compose logs -f nim    # first run: 10–30+ min pull + load
```

**Do not** run `docker compose up` (full stack) if backend/frontend live on Mac — that starts an extra backend container on the GX10 you don't need.

### 3c — Optional ASR on GPU

```bash
docker compose up asr -d
docker compose logs -f asr
```

### 3d — Verify model on GPU (on GX10)

```bash
# LLM API up
curl -s http://localhost:8001/v1/models | head

# GPU memory in use
nvidia-smi

# Container status
docker compose ps
```

Success: `nim` is **Up**, curl returns model JSON, `nvidia-smi` shows VRAM used by docker/NIM.

### 3e — Persist across reboots

Models stay in Docker volumes (`nim-cache`, `asr-cache`). After reboot on GX10:

```bash
cd ~/ProjectHaven && docker compose up nim -d
# optional: docker compose up asr -d
```

No re-download unless you `docker volume rm nim-cache`.

---

## Step 4 — Connect Mac backend to GX10 models

Run on **your Mac** in the project folder.

### 4a — Mac `.env`

```bash
cd ~/Desktop/ProjectHaven   # your local path
cp .env.example .env
```

Edit `.env` — use your GX10 Tailscale IP from admin console:

```bash
GX10_TAILSCALE_IP=100.81.85.39
FORCE_CPU_SOLVER=1
NIM_ENDPOINT=http://100.81.85.39:8001/v1
NIM_FALLBACK=http://100.81.85.39:8001/v1
ASR_NIM_URL=http://100.81.85.39:9000
NGC_API_KEY=your_ngc_key_here    # optional cloud fallback tier
NIM_API_KEY=not-needed
```

**Alternative (SSH tunnel):** if `:8001` is blocked, in a separate terminal:

```bash
ssh -L 8001:localhost:8001 -L 9000:localhost:9000 asus@100.81.85.39
```

Then set `NIM_ENDPOINT=http://localhost:8001/v1` in Mac `.env`.

### 4b — Start backend on Mac

```bash
source .vhaven/bin/activate
pip install -r backend/requirements.txt
python backend/data_ingestion.py --verify --mode cpu

# Load .env into shell (backend reads os.environ, not .env file directly)
set -a && source .env && set +a

uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

### 4c — Start frontend on Mac

Second terminal:

```bash
cd frontend && npm install && npm run dev
```

Open http://localhost:3000/caseworker

### 4d — Verify connection (on Mac)

```bash
# Backend healthy, CPU routing
curl -s http://localhost:8000/api/v1/health | python3 -m json.tool
# "rapids_mode": "cpu"

# Can reach GX10 model directly
curl -s http://100.81.85.39:8001/v1/models | head

# App uses GPU model (not regex)
curl -s -X POST http://localhost:8000/api/v1/caseworker/route \
  -H "Content-Type: application/json" \
  -d '{"text": "need shelter and food, no ID"}' | python3 -m json.tool
# "compile_method": "nim"
```

UI: after routing, badge shows **`NIM`** not **`REGEX`**.

---

## Step 5 — Copy files between Mac and GX10

**Mac ← GX10:**

```bash
scp asus@100.81.85.39:~/ProjectHaven/logs/*.log ~/Desktop/
```

**Mac → GX10:**

```bash
scp .env asus@100.81.85.39:~/ProjectHaven/.env
rsync -avz --exclude node_modules --exclude .vhaven ./ asus@100.81.85.39:~/ProjectHaven/
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `compile_method: "regex"` | GX10 NIM down or Mac can't reach `:8001` — check `curl http://GX10_IP:8001/v1/models` |
| `docker compose logs nim` auth error | Fix `NGC_API_KEY` in GX10 `.env` |
| SSH timeout | Tailscale not Connected on Mac — `tailscale status` |
| `rapids_mode: "gpu"` unexpected | Set `FORCE_CPU_SOLVER=1` on Mac |
| Ran `docker compose up` on GX10 | Stop extra services: `docker compose stop backend asr` — keep `nim` only |

---

## Venue Wi-Fi + delete hotspot

Requires monitor on GX10. After pairing venue Wi-Fi:

```bash
nmcli con show
nmcli con delete gx10-3cd8-Hotspot
```

---

## Quick reference

```
GX10 (models only):
  cd ~/ProjectHaven && cp .env.example .env  # NGC_API_KEY
  docker compose up nim -d
  curl http://localhost:8001/v1/models && nvidia-smi

MAC (backend + frontend):
  .env → NIM_ENDPOINT=http://100.81.85.39:8001/v1, FORCE_CPU_SOLVER=1
  uvicorn backend.main:app --port 8000 --reload
  cd frontend && npm run dev

VERIFY:
  health → rapids_mode: cpu
  route  → compile_method: nim
```

---

## Appendix — Optional: Nemotron or full GPU KNN

**Nemotron (manual download to `~/models/nemotron`, llama.cpp :30000):** see README § Option B.

**RAPIDS GPU KNN (`FORCE_CPU_SOLVER=0`):** not used in Mac+GX10 split; see README appendix only if benchmarking on-box.

---

*Last updated: May 30, 2026 — Mac backend/frontend + GX10 GPU models only*
