# Haven Matrix — 4-Minute Pitch Script

**NVIDIA Spark Hack Toronto · Public Services Track**
Total runtime: **4:00** · ~525 words at ~135 wpm. Each section is timed and word-counted so it can be rehearsed to the clock. Swap the `[Name — Role]` placeholders before presenting.

> **Canonical numbers (do not vary):** 128 GB unified memory (DGX Spark / GX10) · cuML KNN **< 10 ms** on GPU · **Nemotron-30B** LLM · seven data matrices + **9,255 TTC stops** · ~**97%** shelter occupancy · ~**4,000** Central Intake calls/day · composite score 60/30/10 (distance/occupancy/transit).

---

## 1 · Team Intro — 0:00–0:30 (30s, ~68 words)

Hi — we're the team behind **Haven Matrix**.

I'm **[Name — Role]**, with me are **[Name — Role]** and **[Name — Role]**.

We came to Spark Hack with one question: what's the most *human* problem we could put a GPU behind? Not another chatbot — something that helps a real person on a cold night in Toronto find a safe place to sleep. That's Haven Matrix.

---

## 2 · Elevator Pitch — 0:30–1:00 (30s, ~70 words)

**What:** a dual-gateway triage that routes unhoused people — and the caseworkers helping them — to the right Toronto services, in real time.

**How:** you speak; a local model compiles your needs into JSON; cuML runs a constraint-aware nearest-neighbour search on 128 gigabytes — a ranked route in under a second.

**Why:** shelters run ninety-seven percent full; Central Intake takes four thousand calls a day. People in crisis can't navigate hundreds of fragmented services — so we do it for them.

---

## 3 · It In Action — 1:00–2:00 (60s, ~140 words)

Two front doors.

**Gateway A is for caseworkers.** They speak a client's situation — *"man, mid-forties, no ID, needs a bed and a hot meal tonight."* In under a second: a ranked itinerary — nearest shelter with beds free, walk times, live occupancy, a transit badge — plus a warm-handoff phone script to read straight to the shelter.

**Gateway B is a public kiosk** — voice only. Tap a glowing orb, speak. It asks up to three eligibility questions out loud, you tap to confirm each, and it talks back a walking route and a reservation code. No keyboard. No ID. No app.

And it's **alive**: a GPU-versus-CPU benchmark on every request, a shelter-capacity ticker, weather-aware routing that folds in warming centres on a cold alert.

The best part? A **crisis gate fires before the AI ever runs** — self-harm gets 988; a medical emergency gets 911 and the nearest ER on screen. And it all keeps working offline.

---

## 4 · How We Built It — 2:00–3:30 (90s, ~205 words)

The stack: **React, Vite and TypeScript** on the front end; **FastAPI** on the back; **RAPIDS cuDF and cuML** on the GPU; **Nemotron-30B** for inference via llama.cpp, with a Gemma NIM and NVIDIA cloud behind it; **Parakeet** for speech; NeMo Guardrails; and SQLite for cases, auth and reservations.

Our core principle is this: **the LLM is a deterministic compiler, not a decision-maker.** Every model call has a strict Pydantic schema and a regex fallback. Every GPU call has a pandas-and-scikit-learn fallback. So there's a four-tier model chain and a CKAN-to-cache data chain — the system *never* hard-fails.

Each request flows through guarded stages: PII scrub, injection check, guardrails, crisis gate, LLM compile, constraint masking on ID, sobriety, gender and group size — then the cuML solve, composite scoring, and a transit join against the TTC feed.

The system-design bet is the **128 gigabytes of unified memory**: all seven data matrices *and* the model sit in one address space — no PCIe serialization. We run the CPU path in parallel, so the benchmark on screen is a live measurement.

The hardest parts? Prompt injection — blocked deterministically before the model. Privacy — every transcript scrubbed at a single chokepoint; no audio ever leaves the device. And a voice UI that doesn't cut vulnerable people off mid-sentence.

---

## 5 · Closing — 3:30–4:00 (30s, ~68 words)

Who's this for? City caseworkers and street outreach teams. The 211 network. Shelter operators, who get live capacity and an anonymized shadow census of demand. Public health. And — through the kiosk — unhoused people themselves, with no barrier to entry.

Haven Matrix turns a GPU into a lifeline. And that benchmark number on screen? It isn't a claim — it's a measurement, from this hardware, right now.

**Thank you.**

---

### Delivery notes
- Pauses are built into the word budget — don't rush to fill the full count.
- If running long, the trimmable lines are the second sentence of §1 and the weather/ticker line in §3.
- Have the **benchmark panel** and the **kiosk crisis screen** ready to show live during §3 and §5.
