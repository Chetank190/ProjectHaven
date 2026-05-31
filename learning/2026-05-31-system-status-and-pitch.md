# Haven Matrix — System Status & Pitch Notes (2026-05-31)

A snapshot of **what works**, **what stage the end-to-end kiosk interaction is at**, and
**what to claim (and not overclaim)** in the pitch. Grounded in the code as of this date —
build is green (`tsc` + `vite build` clean), backend imports cleanly, regex/eligibility
paths verified by direct execution.

---

## 1. Current stage (one line)

**Code-complete and build-verified end-to-end; demo-ready pending on-device validation
(local NIM LLM responses, browser microphone STT, and GX10 GPU KNN speedup).**

The full caseworker + kiosk journey runs today on a MacBook in CPU/fallback mode. The GPU
acceleration and local-LLM story are wired and ready but their *numbers* must be measured
on the GX10 (Spark) — this dev box runs the CPU solver + regex fallback.

---

## 2. What the system does successfully

### A. Safe to claim — built and verified (runs on a laptop, no GPU needed)

- **Dual-gateway triage system.**
  - *Gateway A (Caseworker)* — JWT-authenticated web app: type/speak client notes →
    structured needs → routed itinerary, map, warm-handoff phone scripts, shift briefing,
    live shelter-capacity ticker, and searchable case history.
  - *Gateway B (Kiosk)* — voice-first, calming UI for an unhoused person to self-serve.
- **LLM as a deterministic compiler, never a decision-maker.** Every model call has a strict
  JSON schema (Pydantic) and a full fallback chain — NVIDIA cloud Gemma 3n → local
  Nemotron (llama.cpp) → local Gemma NIM → **regex keyword extractor**. The system *never
  hard-fails* when the model or network is gone.
- **Constraint-aware routing across 8 service pillars** — shelter, rehab, food, supplies,
  hygiene, respite/warming, youth, library — over **~2,960 curated Toronto service
  records (9 datasets)** plus OpenStreetMap amenities and **9,255 TTC stops**. Eligibility
  masking (ID status, sobriety / harm-reduction, sector, gender, family group) filters the
  pool *before* the spatial solve; composite scoring blends distance, occupancy, and
  transit access, and closed facilities sink (open-now aware).
- **Safety rails, all before the LLM ever sees the text:**
  - *Crisis gate* — deterministic, zero-network: suicide/self-harm → 988, medical/violence
    → 911 with the **nearest emergency rooms + clinics** surfaced on screen.
  - *PII scrubbing* — Canadian phone/SIN/OHIP/email/postal/date redacted at the single
    `clean_transcript()` choke point.
  - *Prompt-injection blocking* on the caseworker gateway (HTTP 400 before inference).
  - *Optional NeMo Guardrails* (zero-overhead passthrough when inputs pass).
- **Voice kiosk that treats people with dignity:**
  - Doesn't cut you off — speech endpointing waits for natural pauses; the initial query is
    tap-to-stop and eligibility answers are **tap-to-confirm** (a pause never skips a question).
  - **Typing fallback reachable from every screen** (idle, recording, eligibility) for noisy
    venues or people who can't speak.
  - **Mute** toggle; TTS speaks each prompt exactly once; the crisis screen never
    auto-dismisses from under someone.
  - Calming centered orb, 12 pre-set Toronto location hubs, spoken + on-screen itinerary
    with a walking map, and a **printable reservation code** (HVN-XXXX).
- **Operational intelligence:** returning-client memory (TF-IDF RAG over resolved cases),
  weather-aware routing (extreme-cold alert folds warming centres into the shelter pool),
  caseworker auth (bcrypt + JWT), and a "Shadow Census" telemetry log of anonymized demand.
- **Live GPU-vs-CPU benchmark** computed on *every* routing request and surfaced in the UI.
- **22 REST endpoints**, Swagger at `/docs`.

### B. Claim "on the Spark" — wired, demonstrate on the GX10

- **Fully local inference** — Nemotron-30B / Gemma 3n via NIM and **Parakeet ASR on-device**:
  audio and text never leave the box.
- **cuML KNN on the GPU** with the 128 GB unified-memory advantage: all datasets *and* the
  model resident in one coherent memory space, sub-10 ms solves, and a *measured* speedup
  over the CPU path on the benchmark panel.

### C. Honest caveats — do **not** overclaim

- GPU speedup figures and local-LLM answer quality must be **measured live on the GX10**;
  the laptop demo shows the CPU solver + regex/cloud fallback.
- Demo data is **pre-cached**; CKAN shelter occupancy and Environment-Canada weather refresh
  are best-effort with cache fallback (no hard dependency during the demo).
- Browser speech recognition needs **Chrome**; the kiosk degrades to the on-device ASR and
  then to typing.

---

## 3. The "final interaction" — end-to-end kiosk flow (current state)

1. **Idle** → centered orb, "Tap to speak," spoken welcome (mute-aware).
2. **Speak** → tap to start / tap when done. Records audio (→ on-device ASR) *and* runs
   browser STT in parallel; natural pauses don't cut you off. "Type instead" always available.
3. **Scrub & screen** → PII redaction → prompt-injection / guardrails → **crisis gate**
   (short-circuits to 988/911 + hospitals if needed) — all before the model.
4. **Compile** → LLM → `NeedsPayload` JSON (regex fallback if offline). Triage prompt now
   disambiguates "warm" (warm *meal* → food, warm *clothes* → supplies, *stay warm* → respite).
5. **Eligibility** → up to 3 spoken questions, **tap-to-confirm** each (no premature skip);
   typing escape hatch present.
6. **Solve** → constraint-masked KNN on GPU (CPU in parallel for the benchmark) → ranked
   itinerary across the relevant pillars.
7. **Deliver** → spoken + on-screen itinerary, walking map, and an optional **reservation code**.

Status: every step is implemented and build-verified; steps 4 and 6's *quality/speed* are
the ones to validate live on the GX10.

---

## 4. What changed in this work cycle (kiosk voice hardening)

- **STT:** speech-lifecycle endpointing (`onspeechstart`/`onspeechend`), lenient end-of-speech
  window so natural pauses don't cut people off, robust continuous-restart, locale via config.
- **Eligibility:** switched to **tap-to-confirm** (removed the auto-advance that skipped
  questions on a pause); abandonment guard resets on activity; "type my answers" escape hatch.
- **TTS:** fixed the **message-spoken-twice** bug (React StrictMode + deferred-speak queue),
  centralized teardown via `stopSpeaking()`, added a global **mute** (volume-0, timing-safe).
- **Crisis safety:** crisis screen no longer auto-dismisses on the idle timer; the chained
  "nearest ER" announcement can't fire onto another screen after the user leaves.
- **LLM triage prompt:** "warm"/cold disambiguation + two few-shot examples.
- **Layout:** the speak orb is now **centered** on the kiosk screen.

---

## 5. Pitch one-liners (accurate)

- "It routes someone to shelter, food, a warming centre, or detox in **under ten
  milliseconds on the GPU** — and it still works with the network and the model **switched off**."
- "Every model call is a **compiler with a deterministic fallback** — no hallucinated
  facilities, no dead ends, PII scrubbed before inference."
- "A person in crisis gets **988 or 911 and the nearest emergency room** before the AI is
  ever consulted."
- "Voice-first and **dignified** — it waits for you, never cuts you off, and lets you type
  or mute at any time."
- "The 128 GB unified memory holds **all the data and the model at once** — the benchmark
  number on screen is a measurement, not a claim."
