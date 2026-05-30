# Voice-Input Resource Navigator — Design Spec

- **Date:** 2026-05-30
- **Status:** Draft for review
- **Author:** mingchen.yang@bell.ca
- **Topic:** On-device speech-input kiosk that helps people experiencing homelessness find the nearest open shelter, food bank, or hospital.

---

## 1. Purpose & Guiding Principles

A push-to-talk kiosk lets a person speak a need in natural language ("I need somewhere warm tonight", "where can I eat?") and receive a warm, accurate, **verified** answer pointing them to the nearest appropriate, currently-open resource.

Guiding principles, in priority order:

1. **Accuracy over cleverness** — a wrong address sends a vulnerable person to the wrong place.
2. **Never invent a resource** — the assistant answers only from a verified directory.
3. **Fail safe to a human** — when unsure, hand off to a person / hotline (e.g., 211).
4. **Dignity & privacy** — minimal data retention, no identity storage, non-judgmental tone.

### Non-goals (v1)

- Real-time / streaming speech-in-speech-out conversation (interaction is button-to-record).
- Multilingual launch — **English first**; French is a planned, low-cost follow-on (see §11).
- Spoken responses (TTS) — **optional phase 2** for accessibility.

---

## 2. Confirmed Decisions

| Area | Decision |
|---|---|
| Connectivity | Local-first on the GX10; cloud allowed but not required. v1 runs fully on-device. |
| Languages | English first; French on roadmap (ASR is French-ready via model choice). |
| Architecture | **Path A — decoupled ASR → text → LLM** (not direct audio→multimodal). |
| Use case | Empathetic, conversational navigation to shelter / food bank / hospital. |
| Resource grounding | **In scope** — verified directory + retrieval is a first-class component. |
| User location | **Fixed kiosk location** — geo is a known constant (no GPS / "where are you?"). |
| LLM | **Gemma 4 26B A4B** (mid-size MoE: quality + empathy + fast on this hardware). |
| Model governance | No provenance/licensing constraint (chosen on quality/speed/fit). |
| Control pattern | **Hybrid** — deterministic crisis gate (code) + bounded tool-calling agent. |
| Agent stack | **NVIDIA NeMo Agent toolkit** (primary orchestration/observability/eval layer); LangGraph and Pydantic AI retained as candidate underlying agent frameworks. |

---

## 3. Hardware Reality Check

Target device: **ASUS Ascent GX10** — NVIDIA GB10 Grace Blackwell Superchip, **128 GB** unified LPDDR5X, ~273 GB/s memory bandwidth.

- The box can *load* very large models (70B unquantized, ~200B at FP4), **but** the ~273 GB/s bandwidth governs conversational speed — a dense 70B model runs at ~2–3 tok/s, too slow for back-and-forth dialogue.
- **Design implication:** prefer a fast **Mixture-of-Experts** model with a small active-parameter count. Gemma 4 26B A4B (~4B active) gives large-model quality at small-model speed.
- Footprint: Gemma 4 26B A4B + Parakeet 0.6B + a small embedding model + Postgres all fit comfortably in 128 GB and run concurrently on one box.

---

## 4. Architecture (Path A, decoupled)

```
[Push-to-talk mic]
   │ audio (PCM/WAV)
   ▼
[ASR: Parakeet TDT 0.6B v3 — NVIDIA Speech NIM]
   │ transcript
   ▼
[Orchestrator]
   ├─ (1) DETERMINISTIC CRISIS GATE (plain code, always runs first)
   │        └─ if crisis → escalation flow (hotline + human handoff)
   ├─ (2) intent classification
   ├─ (3) tool-call → Resource Directory query (structured-first)
   │        (type + kiosk-geo + open-now + eligibility)
   └─ (4) LLM (Gemma 4 26B A4B) composes a grounded, warm reply + citation
   │ response text
   ▼
[Kiosk screen]  (+ optional TTS — phase 2)
```

All components run locally on the GX10. The orchestration/observability/eval layer is **NVIDIA NeMo Agent toolkit**, configured against a **self-hosted NIM** (no cloud API key).

---

## 5. Components

### 5.1 Audio capture
- Button start / stop → PCM/WAV buffer. Visible "listening" state. Maximum-duration cap to bound buffer size.

### 5.2 ASR service
- **Default: NVIDIA Parakeet TDT 0.6B v3** served as an **NVIDIA Speech NIM microservice** (officially supported on DGX Spark / GB10). The ASR boundary is a **swappable service** so models can be A/B'd on our own data.
  - Rationale: transducer (TDT) architecture stays close to the audio and is **far less prone to hallucinating text during pauses/silence** than Whisper or LLM-decoder ASR — important for users who speak haltingly. Very high throughput, punctuation + capitalization + timestamps.
  - v3 covers English **plus** ~25 European languages including French at the same speed → French becomes a **config flag**, not a re-architecture.
- **English WER landscape (Open ASR Leaderboard):** Canary-Qwen 2.5B **5.63%** (leader, but ~6.5× slower + LLM-decoder hallucination risk); Qwen3-ASR 1.7B **5.90%**; Parakeet TDT 0.6B v3 **6.32%** (fastest).
  - **Decision rationale:** the ~0.4–0.7% WER gaps are small and will be **dwarfed by real-world accents/conversational speech**. We do **not** pick on leaderboard delta. We default to Parakeet for low hallucination risk + speed + native NIM + French-readiness, and decide empirically (see §10 / §12).
- **Candidates to benchmark:** Qwen3-ASR (marginally better WER, 52 languages, not a first-party NIM) and Canary-Qwen (best WER, slower, hallucination risk).
- **Fallback: Whisper large-v3** — accent-robustness fallback if Parakeet underperforms on specific accents/dialects (diverse, newcomer population).

### 5.3 Orchestrator (control plane)
- Owns conversation state, intent classification, the crisis gate, tool dispatch, and response assembly.
- **Control pattern: Hybrid.**
  - **(1) Deterministic crisis gate — plain Python, always runs first.** Not delegated to the LLM's discretion. If crisis indicators are detected, control diverts to the escalation flow immediately.
  - **(2) Bounded tool-calling agent** handles the resource conversation within guardrails (allowed tools only, grounded-answer enforcement).
- **Agent stack: NVIDIA NeMo Agent toolkit (primary).** Framework-agnostic orchestration/observability/eval layer.
  - Built-in **evaluation system** → drives our crisis-recall and retrieval-precision eval sets.
  - **Profiler** (per-agent/tool token usage, latency, throughput) → watch responsiveness on the bandwidth-limited GX10.
  - **Observability** via OpenTelemetry / Phoenix / Langfuse.
  - Native **Tool-Calling Agent** workflow (invokes tools directly from schemas, no intermediate reasoning) fits the bounded resource agent.
  - **Self-hosted NIM** LLM config (model name, temperature) → fully local.
- **Candidate underlying agent frameworks** (NeMo can wrap any): begin with NeMo's native Tool-Calling Agent; escalate to **LangGraph** if rich multi-turn state / human-in-the-loop crisis handoff is needed, or **Pydantic AI** if typed Pydantic tool-schema validation is preferred.

### 5.4 Retrieval (structured-first, tiered hybrid)
- A verified **resource directory** in Postgres is queried via **tool/function calls** — filter by type + distance-from-kiosk + open-now + eligibility — rather than dumping a vector blob into the prompt. **Structured filtering is the backbone.**
- A **local embedding model** maps a free-text need ("I haven't eaten in two days", "somewhere to wash up") → category/intent; the structured query then does the actual selection.
- **Rationale:** semantic similarity is poor at "nearest shelter *open right now* that *accepts women with children*" — those are structured filters, not fuzzy matches. Vector/keyword search earns its place mapping messy free-text needs → the right category and ranking among free-text-rich candidates.

**Available retrieval stack (all local NIMs):**
- **Vector store** — NeMo Agent toolkit natively supports **Milvus** (production; native dense+sparse **hybrid**) and **FAISS** (small in-memory DBs). ChromaDB is reachable only via a LangChain/LlamaIndex wrapper, not natively. **Milvus** is the choice if/when we want native hybrid.
- **Embedding (dense)** — **NeMo Retriever Embedding NIM** (or a bge/e5/NV-Embed-class model).
- **Sparse** — BM25/keyword for hybrid (Milvus / Elasticsearch-style).
- **Reranker** — **NeMo Retriever Reranking NIM** (`llama-3.2-nv-rerankqa-1b-v2`). NVIDIA guidance: a reranker is essential once hybrid dense+sparse results must be merged.

**Tiering plan (interface designed so each tier is a config change, not a rewrite):**
1. **v1** — structured filters + single **dense** embedding for intent. Likely sufficient for a modest directory.
2. **+ sparse** — add BM25 hybrid as free-text descriptions/eligibility notes grow.
3. **+ reranker** — add NeMo Retriever reranker once hybrid candidate sets need merging/ranking.

### 5.5 Resource data pipeline
- Ingest from **211 / municipal open data** and **partner org APIs/feeds** → normalize to the directory schema (§6) → verify → stamp `last_verified` and set staleness flags.
- Refresh cadence per source; availability-style fields (capacity/beds) treated as most volatile.

### 5.6 LLM
- **Gemma 4 26B A4B**, served via self-hosted NIM. System prompt enforces: answer **only** from retrieved records, cite them, adopt a calm, non-judgmental tone, and defer to the human-fallback when no record matches.

### 5.7 Safety / guardrail layer
- Crisis detection → hotline + human handoff (highest-priority path).
- Grounding enforcement — the LLM is forbidden from answering resource questions from its own parametric memory.
- Every resource answer shows the source + `last_verified` date.

### 5.8 Output
- Text on the kiosk screen.
- **Optional TTS (phase 2)** for low-literacy / low-vision accessibility (NVIDIA Riva TTS or Qwen3-TTS).

---

## 6. Resource Directory Schema (the heart of RAG)

Each record is a validated **Pydantic** model:

| Field | Notes |
|---|---|
| `name` | Display name |
| `type` | `shelter` \| `food` \| `hospital` \| `clinic` \| `dropin` \| ... |
| `geo` | `{ lat, lng }` — used for distance from fixed kiosk location |
| `address` | Full address |
| `hours` | Structured opening hours (supports "open now" evaluation) |
| `eligibility` | `{ gender, age_range, family, sobriety, referral_required, ... }` |
| `capacity` / `availability` | Optional, most-volatile field |
| `phone` | Contact number (also used for fallback "call ahead") |
| `languages` | Languages served |
| `accessibility` | Wheelchair access, etc. |
| `source` | Provenance (211 / municipal / partner feed) |
| `last_verified` | Timestamp; drives staleness flag |
| `status` | `open` \| `closed` \| `unknown` |

Retrieval = filtered structured query, optionally semantic-ranked. Never a raw vector blob.

---

## 7. Data Flow

1. User presses button → records → presses again to stop.
2. Audio → ASR (Parakeet NIM) → transcript.
3. Orchestrator:
   1. **Crisis gate** (deterministic) → if triggered, escalation flow (hotline + human handoff). **Stop here.**
   2. Intent classification.
   3. Structured directory query: `type + kiosk-geo + open-now + eligibility` → top candidates.
   4. Gemma composes a grounded reply (name/address/hours/phone + "verified `<date>`").
4. Response shown on screen (+ optional TTS).
5. Multi-turn follow-ups supported ("do they allow dogs?", "what about food nearby?").

---

## 8. Error & Edge Handling (fail safe)

| Condition | Behavior |
|---|---|
| Empty / low-confidence ASR | "Sorry, could you say that again?" — invite rephrase. |
| **No directory match** | **Safe fallback** — 211 / human number. Never fabricate. |
| DB / tool unavailable | Graceful degraded message + phone fallback. |
| **Crisis detected** | Immediate hotline info + human handoff (highest priority). |
| Stale record (`last_verified` past threshold) | Caveat shown + "call ahead to confirm." |

---

## 9. Privacy (vulnerable population)

- **Data minimization by design.** Delete audio immediately after transcription.
- **No identity storage.** No names, no account linkage.
- Logs are **anonymized/aggregated**, structured JSON, with **no PII** (per Bell logging standard: `timestamp`, `level`, `message`, `request_id`, `service_name`).
- No sensitive data (tokens, PII) in logs.

---

## 10. Testing (Bell standards)

- **Unit** (`@pytest.mark.unit`) — mock ASR, LLM, and DB. Naming `test_<function>_<scenario>`. ≥60% coverage on changed files.
- **Integration** (`@pytest.mark.integration`) — end-to-end with fixtures (audio → transcript → query → grounded reply), including the crisis-gate path.
- **Load** (Locust) — kiosk concurrency profiles (smoke/load/stress); p95 within SLA, error rate < 1%.
- **Domain eval sets (safety-critical), run via NeMo Agent toolkit evaluation:**
  - **ASR WER bake-off** — Parakeet v3 vs Qwen3-ASR vs Canary-Qwen on a representative **accented / conversational** clip set; choose empirically (don't pick on leaderboard delta).
  - Retrieval precision@k / recall@k against the verified directory; measure the lift from each tier (dense → +sparse → +reranker) to justify added complexity.
  - **Crisis-detection recall — optimize for high recall** (a missed crisis is the worst failure mode).

---

## 11. Roadmap / Phase 2

- **French** — flip Parakeet to multilingual mode; add FR prompts/responses; FR eval set.
- **TTS output** — Riva TTS or Qwen3-TTS for accessibility.
- **LangGraph** — adopt if multi-turn state / persistence / human-in-the-loop crisis handoff becomes central.
- **Direct multimodal (Path B)** — revisit Qwen3-Omni / Phi-4-multimodal once Path A is solid, to leverage tone/prosody cues.

---

## 12. Open Validation Items

1. **Gemma 4 26B A4B function-calling reliability** — NeMo's tool-calling agent needs robust function calling; confirm or select a function-calling-strong alternative for the agent role.
2. **NeMo Agent toolkit version pinning** — newer (v1.6/1.7), recently renamed (AgentIQ → Agent Intelligence → NeMo Agent toolkit); pin a version and watch API churn.
3. **Resource data source contracts** — confirm 211 / municipal open-data formats and partner feed/API availability + refresh cadence.
4. **ASR model choice on real data** — bake-off (Parakeet v3 vs Qwen3-ASR vs Canary-Qwen) on accented clips; also decide whether Whisper large-v3 fallback is needed for specific dialects.
5. **Crisis taxonomy** — define crisis indicators, hotline targets, and human handoff mechanism with domain/social-work input.
6. **Retrieval tier threshold** — decide when free-text content justifies moving from dense-only → Milvus hybrid (dense+sparse) → NeMo Retriever reranker; confirm Milvus vs FAISS for v1 directory size.

---

## 13. Stack & Conventions (Bell)

- Python, **uv** package manager (Bell Artifactory default index), **ruff** lint.
- **Pydantic** models for all structured data (resource records, tool I/O, API payloads, config objects).
- Config module loading/asserting env vars via `os.getenv`; secrets via GCP Secret Manager — **no hardcoded secrets**.
- Type annotations on all signatures; PEP 8 via ruff.
- Structured JSON logging with required fields; no PII.

---

## Sources

- [Best open-source STT 2026 (Gladia)](https://www.gladia.io/blog/best-open-source-speech-to-text-models)
- [NVIDIA Parakeet TDT 0.6B v3 (Hugging Face)](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)
- [NVIDIA Speech NIM — Parakeet on DGX Spark](https://docs.nvidia.com/nim/speech/latest/asr/deploy-asr-models/parakeet-ctc.html)
- [NeMo Agent Toolkit (GitHub)](https://github.com/NVIDIA/NeMo-Agent-Toolkit)
- [NeMo Agent Toolkit Overview](https://docs.nvidia.com/nemo/agent-toolkit/latest/)
- [NeMo Agent Toolkit — Tool Calling Agent](https://docs.nvidia.com/nemo/agent-toolkit/1.2/workflows/about/tool-calling-agent.html)
- [NeMo Agent Toolkit — Retrievers (Milvus/FAISS)](https://docs.nvidia.com/nemo/agent-toolkit/1.3/workflows/retrievers.html)
- [NeMo Retriever (embedding + reranking + hybrid)](https://developer.nvidia.com/nemo-retriever)
- [NeMo Retriever Reranking NIM](https://docs.nvidia.com/nim/nemo-retriever/text-reranking/latest/overview.html)
- [NeMo Retriever Embedding NIM](https://docs.nvidia.com/nim/nemo-retriever/text-embedding/latest/overview.html)
- [Open-source STT benchmarks 2026 (Northflank)](https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks)
- [GB10 boxes compared (InsiderLLM)](https://insiderllm.com/guides/gb10-boxes-compared/)
- [ASUS Ascent GX10](https://www.asus.com/networking-iot-servers/desktop-ai-supercomputer/ultra-small-ai-supercomputers/asus-ascent-gx10/)
- [Best local LLMs 2026 (Hugging Face)](https://huggingface.co/blog/daya-shankar/open-source-llms)
- [Qwen3-Omni (GitHub)](https://github.com/QwenLM/Qwen3-Omni)
- [Phi-4-multimodal (Hugging Face)](https://huggingface.co/microsoft/Phi-4-multimodal-instruct)
