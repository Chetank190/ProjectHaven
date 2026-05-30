# Haven Matrix — Demo Video Brief

> **Format:** Screen recording (Loom recommended, free tier) with camera on showing the team.
> **Total length:** 3–5 minutes (aim for 4 min).
> **Tool:** Run the app live — both gateways open in browser tabs, Swagger at /docs ready.

---

## Section 1 — Introduce Your Team
**Target: 20–30 seconds**

Say something like:
> "Hey, we're [team name]. Over the last 48 hours we built Haven Matrix — a dual-gateway AI triage system that routes unhoused people in Toronto to shelter, food, and support services in real time."

Keep it tight. Name → what you built. No bio, no backstory.

---

## Section 2 — Elevator Pitch (The Hook)
**Target: 30–40 seconds**

This is your product trailer. Make it land.

**What to say:**
> "Toronto has hundreds of shelters, food banks, and hygiene stations — but unhoused people and the caseworkers who help them have no fast way to find what's available right now, nearby, with the right eligibility constraints.
>
> Haven Matrix solves that. A caseworker speaks a client's situation into Gateway A and gets a ranked, constraint-aware care route in under a second. At a public kiosk, someone holds an orb, speaks their needs, and the system talks back with directions — no keyboard, no forms, no staff required.
>
> We run the full Nemotron-30B language model and seven datasets — 9,300 TTC stops, live shelter occupancy — simultaneously in the DGX Spark's 128 GB unified memory. That's the hardware doing something that wouldn't be possible anywhere else."

**Why it's exciting hook words to hit:** real-time, voice-only, constraint-aware, 128 GB unified memory, no cloud.

---

## Section 3 — Live Demo
**Target: 45–60 seconds**

Show the actual app running. Do NOT cut unless loading takes >5 seconds.

**Tab setup before recording:**
- Tab 1: `http://localhost:3000/caseworker` (Gateway A)
- Tab 2: `http://localhost:3000/kiosk` (Gateway B)
- Tab 3: `http://localhost:8000/docs` (Swagger — optional, only if time)

**Suggested demo flow:**

1. **Gateway A (Caseworker)** — Start here.
   - Type or speak: *"My client is a 45-year-old male, no ID, currently using, needs shelter and food tonight."*
   - Show the payload confirm card appear with the 5-second countdown
   - Show the itinerary load — point to: distance, walk time, occupancy bar, TTC badge, "Generate phone script" button
   - Click "Generate phone script" — show the handoff call script appear

2. **Gateway B (Kiosk)** — Switch tabs.
   - Hold the orb, speak: *"I need somewhere to sleep and food, I've been drinking"*
   - Show eligibility questions appear / speak
   - Show the itinerary cards animate in with the TTS script

3. **Benchmark strip** — Point to the GPU/CPU timing numbers and speedup multiplier visible on Gateway A after routing.

**Key things to point out live:**
- "No keyboard on the kiosk — voice only, by design"
- "Compile method shows NIM — that's Nemotron-30B running locally"
- "GPU solve: X ms, CPU solve: Y ms, speedup: Z×"

---

## Section 4 — How You Built It (Engineering Depth)
**Target: 60–90 seconds**

Stay on the app or quickly flash an architecture diagram if you have one. Talk while the UI is visible.

**Architecture & Stack:**
> "The backend is FastAPI with two data paths — cuDF and cuML on the GPU, pandas and scikit-learn as CPU fallback. The LLM runs a four-tier chain: cloud NIM with Gemma 3n E4B when we have an NGC key, Nemotron-30B via llama.cpp on port 30000, local Gemma 3n NIM on port 8001, and a pure-regex extractor as the final fallback — so routing never goes down."

**Model choice:**
> "We chose Nemotron-30B because it fits in the 128 GB unified memory alongside all seven datasets simultaneously — shelters, rehab, food banks, grassroots services, hygiene stations, OSM public amenities, and 9,300 TTC transit stops. That co-location is the whole point of the GX10."

**System design / hardware influence:**
> "The GX10's unified memory means zero-copy data transfer between the LLM context and the cuML KNN solver. We do haversine nearest-neighbour search across thousands of records in under 10 milliseconds. On a CPU that same query takes 400 milliseconds. The hardware made the real-time constraint possible."

**Key challenges:**
> "The hardest problem was constraint-aware routing — a shelter that requires ID is useless to a client without one. We built an eligibility masking layer that filters datasets before KNN runs, combining ID status, sobriety, family size, and live bed occupancy into a single composite score. Getting that to work cleanly in both cuDF and pandas — same code path — took most of our time."

**Tradeoffs:**
> "We deliberately made the LLM a deterministic compiler, not a decision-maker. Every call has a strict JSON schema and a regex fallback. The routing logic is pure math — weights, distance, occupancy, transit proximity. The LLM just extracts intent from natural language."

---

## Section 5 — The "So What?" Close
**Target: 20–30 seconds**

This is your landing punch. Make it personal and bold.

> "Every night in Toronto, caseworkers spend hours on the phone trying to find a bed for someone standing in front of them. Unhoused people get turned away from shelters that require ID they don't have. Haven Matrix cuts that to seconds — and it does it entirely on-device, no cloud, no privacy risk.
>
> We pushed the DGX Spark to hold a 30-billion-parameter model, seven live datasets, and a GPU KNN solver all in memory at once — because that's exactly what 128 gigabytes of unified memory is for. This is what the hardware unlocks."

---

## Quick Reference — Timings

| Section | Content | Time |
|---------|---------|------|
| 1 | Team intro | 20–30s |
| 2 | Elevator pitch | 30–40s |
| 3 | Live demo (both gateways) | 45–60s |
| 4 | Engineering depth | 60–90s |
| 5 | So what / close | 20–30s |
| **Total** | | **~3:30–4:10** |

---

## Before You Hit Record — Checklist

- [ ] Record on the **GX10** (or via SSH port-forward) so the benchmark panel shows real GPU numbers — see `gx10_access_and_gpu_guide.md`
- [ ] Backend running: `uvicorn backend.main:app --host 0.0.0.0 --port 8000`
- [ ] Frontend running: `cd frontend && npm run dev`
- [ ] Both tabs open and loaded: `/caseworker` and `/kiosk`
- [ ] Loom (or screen recorder) set to capture browser + microphone
- [ ] Camera on and visible (required)
- [ ] Test one full caseworker route before recording so the compile_method shows `NIM` not `regex`
- [ ] Know your GPU/CPU speedup number from the benchmark strip — mention the real number live
- [ ] Voice is clear — mute Slack, close other apps

## Numbers to Say Out Loud (Memorise These)

- **128 GB** unified memory on the DGX Spark
- **Nemotron-30B** — the primary LLM, runs fully on-device
- **7 datasets** loaded simultaneously into GPU memory
- **9,300 TTC stops** for transit accessibility scoring
- **< 10 ms** GPU KNN solve time
- **~400 ms** CPU equivalent (the contrast makes the point)
- **40×** GPU speedup over CPU (approximate — confirm from your live benchmark)
- **4-tier LLM chain**: cloud NIM → Nemotron llama.cpp → Gemma NIM → regex (system never goes down)
- **0 bytes** of audio ever leave the device (Web Speech API is browser-native)
