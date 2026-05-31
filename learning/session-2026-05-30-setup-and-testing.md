# Haven Matrix — Setup, Debugging & Testing Session
**Date:** 2026-05-30

---

## 1. Dependency Audit

### Frontend (`frontend/`)
`node_modules/` was empty — `npm install` had never been run.

**Packages installed:**
| Package | Version | Role |
|---|---|---|
| `react` | ^18.3.0 | UI framework |
| `react-dom` | ^18.3.0 | DOM renderer |
| `react-router-dom` | ^6.24.0 | Client-side routing |
| `axios` | ^1.7.0 | HTTP client |
| `vite` | ^5.3.0 | Dev server / bundler |
| `typescript` | ^5.4.0 | Type checker |
| `tailwindcss` | ^3.4.0 | Utility CSS |
| `leaflet` + `react-leaflet` | latest | Map component (added mid-session) |

**Fix:**
```bash
cd frontend && npm install
cd frontend && npm install leaflet react-leaflet @types/leaflet --legacy-peer-deps
```

---

### Backend (`.venv/`)
Most packages from `requirements.txt` were already installed. Missing:

| Package | Reason needed |
|---|---|
| `langchain-core` | `guardrails_client.py` PassthroughLLM |
| `passlib` | `auth_store.py` bcrypt password hashing |
| `python-jose` | `auth_store.py` JWT token generation |
| `openai` (upgrade) | `openai==1.35.0` broke due to `proxies` kwarg conflict |

**Fix:**
```bash
.venv/bin/pip install langchain-core
.venv/bin/pip install passlib python-jose
.venv/bin/pip install --upgrade openai   # 1.35.0 → 2.38.0
```

> **Note:** `langchain-core` also upgraded `pydantic` from `2.7.0 → 2.13.4`, which broke `openai==1.35.0`. Always upgrade `openai` after installing `langchain-core`.

---

## 2. Environment Configuration

`.env` required two keys to run properly:

```env
NGC_API_KEY=<your-ngc-key>
FORCE_CPU_SOLVER=1
```

- `FORCE_CPU_SOLVER=1` — skips `cuml` GPU KNN (not installed); uses `scikit-learn` on CPU instead. GPU is still used for the LLM.
- `cuml` is not in `.venv` — only available inside the full RAPIDS container on GX10.

---

## 3. Running the Servers

### Backend
```bash
FORCE_CPU_SOLVER=1 NGC_API_KEY=<key> .venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

### Frontend
```bash
cd frontend && npm run dev
```
Frontend runs on **port 3001** (locked via `vite.config.ts` `strictPort: true`).

### Stopping both
```bash
fuser -k 8000/tcp 3001/tcp
```

---

## 4. Bugs Found & Fixed

### Bug 1 — GPU KNN solver crash (`cuml` missing)
**Error:** `GPU solve failed: No module named 'cuml'`

**Cause:** Server started in GPU mode (cuDF loaded fine), but `solver.py` imports `cuml` for KNN which isn't installed in `.venv`.

**Fix:** Set `FORCE_CPU_SOLVER=1` in `.env` → routes via `scikit-learn` instead.

---

### Bug 2 — LLM falling back to regex (`openai` proxies bug)
**Error:** `Client.__init__() got an unexpected keyword argument 'proxies'`

**Cause:** `langchain-core` install changed an internal `httpx`/`pydantic` dependency that broke `openai==1.35.0`'s client initialisation. All 3 NIM tiers failed silently, causing regex fallback.

**Fix:** `pip install --upgrade openai` → upgraded to `2.38.0`, resolving the conflict.

---

### Bug 3 — Frontend port drift
**Symptom:** Vite silently moved from port 3000 → 3001 when a stale process still held 3000.

**Fix:** Added `strictPort: true` to `vite.config.ts` so Vite errors instead of drifting.

---

### Bug 4 — Duplicate Vite processes
**Cause:** Multiple background start attempts left 2 Vite processes running simultaneously.

**Fix:** `fuser -k 3001/tcp` before restarting. Always kill the port before relaunching.

---

## 5. Model Stack

| Role | Model | Where | Status |
|---|---|---|---|
| **LLM** | Google Gemma 3n E4B | NVIDIA Cloud API (`integrate.api.nvidia.com`) | ✅ Active |
| **ASR / STT** | Parakeet-0.6B-CTC NIM | Local Docker (`:9000`) | ❌ Not running |
| **ASR fallback** | NVIDIA Cloud ASR | `integrate.api.nvidia.com` | ⚠️ Attempted |
| **ASR final fallback** | Browser Web Speech API | Built into browser (Google) | ✅ Active |
| **TTS** | Browser `speechSynthesis` | Built into browser (OS voice) | ✅ Active |

To activate on-device ASR:
```bash
docker compose up asr
```

---

## 6. New Backend Modules (added in latest commits)

### `auth_store.py`
- SQLite-backed caseworker authentication
- bcrypt password hashing via `passlib`
- JWT token generation via `python-jose`
- Endpoints: `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `GET /api/v1/auth/me`

### `case_store.py`
- SQLite case history per caseworker
- TF-IDF semantic similarity search (`find_similar()`) for RAG context injection
- Outcome tracking: `pending → placed / declined / returned / referred_elsewhere`
- Endpoints: `GET /api/v1/caseworker/{id}/history`, `PATCH /api/v1/case/{id}/outcome`

---

## 7. UI Testing Results

### Caseworker Gateway — `http://localhost:3001/caseworker`
- Login required (new auth flow)
- Test account: `test@haven.ca` / `Haven123!`
- Header shows: caseworker name, sign out, live capacity ticker (e.g. `97.0% Critical — 389 beds free`)
- MY CASES panel shows case history
- Client notes → Route Client → returns shelter/rehab/food/hygiene results + care ticket

**Test input used:**
> "27 year old man, currently using, looking for detox and somewhere to sleep. Willing to go to harm reduction shelter."

**Result:** 3 shelters + 3 rehab facilities returned, `method: nim` (Gemma 3n), handoff ticket generated.

---

### Kiosk Gateway — `http://localhost:3001/kiosk`
- No login required
- Flow: pick hub → voice orb or "Type instead" → eligibility questions → itinerary
- Test hub: Union Station

**Test input used:**
> "I need a shelter for tonight and some food. I have been drinking. I am alone. I have ID."

**Result:**

| Pillar | Facility | Walk |
|---|---|---|
| Shelter | City of Toronto — 339 George St | 11 min |
| Rehab | Anishnawbe Health Toronto — 225 Queen St E | 11 min |
| Food | Ve'ahavta Mobile Food Pantry — Downtown Core | 11 min |
| Respite | Metro Hall Emergency Warming — 55 John St | 9 min |

Each card includes: address, phone, TTC accessibility badge, intake instructions.

---

## 8. Quick Reference — Start Commands

```bash
# Backend
FORCE_CPU_SOLVER=1 NGC_API_KEY=<key> .venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8000

# Frontend
cd frontend && npm run dev

# Stop everything
fuser -k 8000/tcp 3001/tcp

# API docs
open http://localhost:8000/docs

# Register test user
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@haven.ca","name":"Test Worker","password":"Haven123!"}'
```
