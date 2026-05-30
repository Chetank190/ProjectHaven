# GX10 Access + GPU Model Setup

> **Start here** for SSH access, Tailscale, and wiring Haven Matrix to the GX10 GPU.
> Companion docs: `haven_matrix_reference.md` (day-of checklist), `haven_matrix_implementation.md` (full spec).

---

## Your Unit — gx10-3cd8

| Field | Value |
|-------|-------|
| Hotspot SSID | `gx10-3cd8` |
| Hotspot Password | `gx10-3cd8` |
| SSH System Name | `asus@gx10-3cd8.local` |
| Username | `asus` |
| Password | `password` |

> **No pamphlet in the box?** Flip the unit over and read the **MAC1** sticker. Use the last 4 characters to complete the name. Example: MAC1 ending in `3C:D8` → `asus@gx10-3cd8.local`.

---

## Important: No Wi-Fi on the GX10

The GX10 has **no built-in Wi-Fi**. All initial remote access goes through a **mobile hotspot** → SSH. After Tailscale is set up, you can SSH from anywhere without the hotspot.

Remote access info is also on the pamphlet in the box. One or two units at the event may lack a pamphlet — the credentials pattern is the same for all units.

---

## Step 1 — SSH via Mobile Hotspot

### Connect your laptop to the hotspot

Turn on your phone's mobile hotspot **or** your laptop's hotspot. The GX10 will auto-connect to a saved hotspot profile.

Connect **your laptop** to:

| Field | Value (your unit) |
|-------|-------------------|
| SSID | `gx10-3cd8` |
| Password | `gx10-3cd8` |

### SSH in

Open **Terminal** (Mac/Linux — preferred on Mac) or **PowerShell as Administrator** (Windows):

```bash
ssh asus@gx10-3cd8.local
```

When prompted:

1. Type `yes` and press Enter (accepts the host key fingerprint)
2. Password: `password` and press Enter

You know it worked when you see the GX10 shell prompt.

**Other units at the event** use the same pattern: `ssh asus@gx10-XXXX.local` where `XXXX` is the 4-character ID from the pamphlet or MAC1 sticker.

---

## Step 2 — Tailscale (Persistent Remote Access)

Use Tailscale so you can SSH into the GX10 from any network — venue Wi-Fi, home, etc. — without needing the hotspot.

### Install Tailscale on your laptop first

Download: **https://tailscale.com/download**

- **Do NOT use a `.edu` email** — institutional emails block Tailscale registration on both devices
- Use a personal Gmail, Outlook, or GitHub account

**Mac:**

- Allow all configuration prompts during install
- A Tailscale icon appears in the menu bar — click it and make sure it is **enabled**
- If the icon is hidden: remove some menu bar icons and it will reappear

**Windows:**

- Tailscale lives in the **hidden system tray** (bottom-right, click the ^ arrow)
- Right-click the icon → Connect

### Pair the GX10 (Tailscale is pre-installed on the unit)

SSH into the GX10 first (Step 1), then run:

```bash
sudo tailscale up
```

This prints a URL. Copy it → paste in your **laptop browser** → authorize.

The GX10 is now on your Tailscale network.

### SSH via Tailscale (daily access)

```bash
# By hostname:
ssh asus@gx10-3cd8

# By Tailscale IP (starts with 100.):
ssh asus@100.X.X.X
# Find the IP in your Tailscale app under "Machines"
```

### Invite teammates

**Team invite link (Project Haven):**

https://login.tailscale.com/uinv/iC7hHtsfaC215vP2zbheG11

Or via admin console:

1. Open **Tailscale admin console** (tailscale.com → Admin Console)
2. Click **Invite users** → **Invite by email**
3. Teammate installs Tailscale → prompted to join a tailnet → **choose the Host email** (two emails may appear — pick the host's)
4. Teammate can then SSH: `ssh asus@gx10-3cd8` or `ssh asus@100.X.X.X`

---

## Step 3 — Venue Wi-Fi Transition (Requires Monitor)

The hotspot profile is **persistent** — the GX10 reconnects to it on every reboot.

To switch to venue Wi-Fi:

1. Connect a **monitor** to the GX10
2. Turn off the hotspot connection and pair with venue Wi-Fi on the GX10 directly
3. Delete the saved hotspot profile so it does not reconnect on reboot:

```bash
nmcli con show                         # list all saved connections
nmcli con delete gx10-3cd8-Hotspot     # permanent — use your unit's hotspot name
```

After deletion, the GX10 only connects to saved Wi-Fi networks.

---

## Step 4 — Connect the LLM Model to GPU

Haven Matrix uses the GX10 GPU in **two separate processes**. Both must run for full demo mode (`compile_method: nim` + `rapids_mode: gpu`).

| Layer | Process | Port | Env var |
|-------|---------|------|---------|
| **LLM triage** (primary) | llama.cpp Nemotron (`--n-gpu-layers 99`) | 30000 | `NIM_ENDPOINT=http://localhost:30000/v1` |
| **LLM triage** (fallback) | Docker NIM Gemma 3n E4B | 8001 | `NIM_FALLBACK=http://localhost:8001/v1` |
| **KNN solver** | RAPIDS container (cuDF + cuML) | 8000 | auto-detected at startup |

**LLM retry chain:** cloud NIM (if `NGC_API_KEY`) → Nemotron :30000 → Gemma NIM :8001 → regex.

### 4a — Verify hardware

```bash
nvidia-smi && uname -m
# Must show GB10 GPU and aarch64
```

### 4b — Download Nemotron weights (~38 GB)

```bash
pip install huggingface-hub
huggingface-cli download ggml-org/NVIDIA-Nemotron-3-Nano-Omni \
  nemotron-3-nano-omni-ga_v1.0-Q8_0.gguf \
  --local-dir ~/models/nemotron
```

### 4c — Build llama.cpp with CUDA (one-time, ~15–20 min)

```bash
git clone https://github.com/ggml-org/llama.cpp ~/llama.cpp
cd ~/llama.cpp
cmake -B build -DGGML_CUDA=ON
cmake --build build -j$(nproc)
```

### 4d — Start Nemotron on GPU (keep this terminal open)

```bash
~/llama.cpp/build/bin/llama-server \
  --model ~/models/nemotron/nemotron-3-nano-omni-ga_v1.0-Q8_0.gguf \
  --host 0.0.0.0 \
  --port 30000 \
  --n-gpu-layers 99 \
  --ctx-size 8192 \
  --threads 8
```

Test it:

```bash
curl http://localhost:30000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"nemotron","messages":[{"role":"user","content":"Reply with exactly: {\"test\":true}"}]}'
```

### 4e — Start RAPIDS backend (GPU KNN)

**Option A — Docker Compose (recommended):**

```bash
cd ~/ProjectHaven
# Set NGC_API_KEY in .env first if using cloud NIM tier
docker compose up
```

This starts Gemma 3n NIM on :8001 and FastAPI + RAPIDS on :8000.

**Option B — Manual RAPIDS container:**

```bash
cd ~/ProjectHaven
docker pull rapidsai/base:25.06-cuda12-py3.12
docker run --gpus all --network host -v $(pwd):/app -w /app \
  -it rapidsai/base:25.06-cuda12-py3.12 bash

# Inside container:
pip install -r backend/requirements.txt -q
python3 -c "import cudf, cuml; print('RAPIDS OK')"
python3 backend/data_ingestion.py --verify --mode gpu
python3 backend/solver.py --benchmark
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

### 4f — Start frontend (host OS, new terminal)

```bash
cd ~/ProjectHaven/frontend && npm install && npm run dev
```

### 4g — Verify everything

```bash
curl http://localhost:8000/api/v1/health
# Expect: "rapids_mode": "gpu", 7 datasets loaded

curl -X POST http://localhost:8000/api/v1/caseworker/route \
  -H "Content-Type: application/json" \
  -d '{"text": "need shelter and food, no ID, been drinking"}'
# Expect: "compile_method": "nim", itinerary with results

curl http://localhost:8000/api/v1/benchmark
# Expect: last_gpu_ms < 10, speedup > 10
```

---

## Step 5 — Use the UI from Your Laptop (SSH Port Forwarding)

Services run on the GX10. To open the browser on your laptop:

```bash
ssh -L 3000:localhost:3000 -L 8000:localhost:8000 asus@gx10-3cd8
```

Then on your laptop:

- Caseworker: http://localhost:3000/caseworker
- Kiosk: http://localhost:3000/kiosk
- Swagger: http://localhost:8000/docs

---

## Fallback — If Nemotron Download Is Too Slow

Use the NIM container only (zero code change):

```bash
cd ~/ProjectHaven
echo "NIM_ENDPOINT=http://localhost:8001/v1" >> .env
echo "NIM_FALLBACK=http://localhost:8001/v1" >> .env
docker compose up
```

Or start NIM manually:

```bash
docker run --gpus all --network host \
  -e NGC_API_KEY=$NGC_API_KEY \
  -v nim-cache:/opt/nim/.cache \
  -p 8001:8000 \
  nvcr.io/nim/google/gemma-3n-e4b-it:latest
```

---

## Terminal Layout (Day-of Demo)

| Terminal | What it runs |
|----------|-------------|
| 1 | `watch -n 1 nvidia-smi` — GPU usage visible during demo |
| 2 | llama.cpp Nemotron server (port 30000) |
| 3 | RAPIDS container → uvicorn FastAPI (port 8000) |
| 4 | React frontend (port 3000) |
| 5 (laptop) | SSH port-forward OR direct browser on GX10 monitor |

---

## Quick Reference Card

```
YOUR UNIT (gx10-3cd8):
  Hotspot SSID/Password:  gx10-3cd8
  SSH:                    ssh asus@gx10-3cd8.local
  Username / Password:    asus / password

INITIAL ACCESS:
  Connect laptop to hotspot → ssh asus@gx10-3cd8.local → yes → password

TAILSCALE SETUP (once):
  Install on laptop → SSH in → sudo tailscale up → authorize URL
  Team invite: https://login.tailscale.com/uinv/iC7hHtsfaC215vP2zbheG11

DAILY REMOTE ACCESS:
  ssh asus@gx10-3cd8  (or ssh asus@100.X.X.X via Tailscale)

USE UI FROM LAPTOP:
  ssh -L 3000:localhost:3000 -L 8000:localhost:8000 asus@gx10-3cd8

GPU MODEL (LLM):
  llama-server --n-gpu-layers 99 --port 30000  →  NIM_ENDPOINT

GPU SOLVER (KNN):
  docker compose up  OR  RAPIDS container  →  rapids_mode: gpu

DELETE HOTSPOT (after venue Wi-Fi):
  nmcli con delete gx10-3cd8-Hotspot
```

---

*Last updated: May 30, 2026 — official pamphlet SSH/Tailscale + GPU model wiring for gx10-3cd8*
