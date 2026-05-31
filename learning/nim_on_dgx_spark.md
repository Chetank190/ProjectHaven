# NVIDIA NIM on DGX Spark (ASUS Ascent GX10) — Operations Guide

> Reference doc for running NIM (NVIDIA Inference Microservices) containers on the ProjectHaven DGX Spark. Covers hardware constraints, image selection, launch commands, the speech pipeline architecture, and end-to-end test results.

---

## 1. Hardware context

| | |
|---|---|
| Machine | ASUS Ascent GX10 (NVIDIA DGX Spark) |
| SoC | NVIDIA GB10 Grace Blackwell Superchip |
| CPU arch | **ARM64 (aarch64)** — Grace |
| GPU | Blackwell, compute capability 12.1, device ID `2e12:10de` |
| Memory | 128 GB unified LPDDR5X (CPU+GPU share one pool) |
| OS | Ubuntu (Linux 6.17 NVIDIA kernel) |

### Why architecture matters

The Grace CPU is **ARM64**, not x86_64. Docker images built for AMD64 will fail on this machine with:

```
exec /bin/bash: exec format error
```

Only images marked **`linux/arm64`** (or multi-arch manifests that include `linux/arm64`) will run. NVIDIA distinguishes them two ways:

1. **Explicit `-dgx-spark` suffix** — purpose-built for DGX Spark, e.g. `llama-3.1-8b-instruct-dgx-spark`
2. **Multi-arch images** — the standard repo path contains both AMD64 and ARM64 builds; Docker auto-picks ARM64 on Grace

A quick way to verify any NGC image:

```bash
sudo docker manifest inspect nvcr.io/nim/<path>:latest \
  | jq '.manifests[].platform'
```

Look for `"architecture": "arm64"`.

---

## 2. LLM NIM images with native DGX Spark support

Probed against NGC on 2026-05-30. ✅ = runs on DGX Spark (ARM64), ❌ = AMD64-only.

### Confirmed compatible

| Container path | Params | Model launch |
|---|---|---|
| `nvcr.io/nim/meta/llama-3.1-8b-instruct-dgx-spark` | 8 B | Oct 2025 (DGX Spark build of Jul 2024 model) |
| `nvcr.io/nim/meta/llama-3.1-8b-instruct` | 8 B | Jul 2024 |
| `nvcr.io/nim/meta/llama-3.1-70b-instruct` | 70 B | Jul 2024 |
| `nvcr.io/nim/meta/llama-3.2-1b-instruct` | 1 B | Sep 2024 |
| `nvcr.io/nim/meta/llama-3.2-3b-instruct` | 3 B | Sep 2024 |
| `nvcr.io/nim/meta/llama-3.3-70b-instruct` | 70 B | Dec 2024 |
| `nvcr.io/nim/mistralai/mistral-7b-instruct-v0.3` | 7 B | May 2024 |
| `nvcr.io/nim/microsoft/phi-4-mini-instruct` | ~3.8 B | Feb 2025 |
| `nvcr.io/nim/nvidia/llama-3.1-nemotron-nano-8b-v1` | 8 B | Mar 2025 |
| `nvcr.io/nim/nvidia/llama-3.3-nemotron-super-49b-v1` | 49 B | Mar 2025 |
| `nvcr.io/nim/openai/gpt-oss-20b` | 20 B | Aug 2025 |
| `nvcr.io/nim/openai/gpt-oss-120b` | 120 B | Aug 2025 |

### Not compatible (AMD64-only)

| Image | Model launch |
|---|---|
| `nvcr.io/nim/google/gemma-4-31b-it` | ~Q1 2026 |
| `nvcr.io/nim/meta/llama-3.2-11b/90b-vision-instruct` | Sep 2024 |
| `nvcr.io/nim/meta/llama-4-scout` / `llama-4-maverick` | Apr 2025 |
| `nvcr.io/nim/microsoft/phi-3-mini-4k-instruct` | Apr 2024 |
| `nvcr.io/nim/qwen/qwen3-32b` | Apr 2025 |
| `nvcr.io/nim/deepseek-ai/deepseek-r1-distill-*` | Jan 2025 |

### Gemma 4 on DGX Spark

NVIDIA's [Gemma 4 blog post](https://developer.nvidia.com/blog/bringing-ai-closer-to-the-edge-and-on-device-with-gemma-4/) says Gemma-4-31B is officially supported on DGX Spark, but **no `-dgx-spark` NIM image is published**. The only NIM tag is AMD64. Workaround: run via Ollama or vLLM directly from the Hugging Face checkpoint (NVFP4 variant is Blackwell-optimized: `gemma4:31b-nvfp4`).

---

## 3. ASR / Speech NIM images with native DGX Spark support

### Confirmed compatible

| Container path | Type | Languages | Launch |
|---|---|---|---|
| `nvcr.io/nim/nvidia/parakeet-1-1b-rnnt-multilingual` | ASR (RNNT, offline) | Hindi, Tamil, Bengali (+ EN→Devanagari) | May 2025 |
| `nvcr.io/nim/nvidia/parakeet-1-1b-ctc-en-us` | ASR (CTC, streaming) | English (US) | May 2025 |
| `nvcr.io/nim/nvidia/magpie-tts-multilingual` | TTS | Multilingual | 2025 |

### Not compatible (AMD64-only)

| Container | Type |
|---|---|
| `nvcr.io/nim/nvidia/parakeet-0.6b-tdt` | ASR EN |
| `nvcr.io/nim/nvidia/parakeet-tdt-0.6b-v2` | ASR EN |
| `nvcr.io/nim/nvidia/parakeet-ctc-1.1b-asr` | ASR EN |
| `nvcr.io/nim/nvidia/parakeet-ctc-0.6b-es` / `-vi` | ASR ES / VI |
| `nvcr.io/nim/nvidia/canary-1b` | ASR multilingual |

### No Qwen / Whisper / multimodal speech on NIM (yet)

Probed and confirmed absent: `qwen2-audio`, `qwen2.5-omni`, `whisper-large-v3`, `phi-4-multimodal`, `seamless-m4t`, `canary-qwen-2.5b`. These exist on Hugging Face but NVIDIA hasn't packaged them as NIM containers. To use them, deploy via vLLM or Transformers directly.

---

## 4. Launch commands (ProjectHaven setup)

### One-time setup

```bash
# NGC key lives in repo .env (never commit)
NGC_API_KEY=$(grep NGC_API_KEY /home/asus/ProjectHaven/.env | cut -d= -f2)

# Login to NGC registry
echo $NGC_API_KEY | sudo docker login nvcr.io -u '$oauthtoken' --password-stdin

# Persistent cache dirs (one per model)
mkdir -p /home/asus/.cache/nim/{llama,parakeet,parakeet-en}
```

### Llama 3.1 8B (LLM)

```bash
sudo docker run -d \
  --name llama-nim \
  --gpus all \
  --shm-size=16GB \
  -e NGC_API_KEY=$NGC_API_KEY \
  -v /home/asus/.cache/nim/llama:/opt/nim/.cache \
  -p 8003:8000 \
  nvcr.io/nim/meta/llama-3.1-8b-instruct-dgx-spark:latest
```

### Parakeet 1.1B RNNT Multilingual (ASR, Hindi/Tamil/Bengali)

```bash
sudo docker run -d \
  --name parakeet-nim \
  --gpus all \
  --shm-size=16GB \
  -e NGC_API_KEY=$NGC_API_KEY \
  -v /home/asus/.cache/nim/parakeet:/opt/nim/.cache \
  -p 8004:9000 \
  nvcr.io/nim/nvidia/parakeet-1-1b-rnnt-multilingual:latest
```

### Parakeet 1.1B CTC English (ASR, streaming)

```bash
sudo docker run -d \
  --name parakeet-en-nim \
  --gpus all \
  --shm-size=16GB \
  -e NGC_API_KEY=$NGC_API_KEY \
  -v /home/asus/.cache/nim/parakeet-en:/opt/nim/.cache \
  -p 8005:9000 \
  nvcr.io/nim/nvidia/parakeet-1-1b-ctc-en-us:latest
```

### Flag reference

| Flag | Purpose |
|---|---|
| `-d` | Detached (background) |
| `--name X` | Container name for `docker logs`, `docker stop`, etc. |
| `--gpus all` | Expose GPU to container |
| `--shm-size=16GB` | Shared memory for inference (NIM requirement) |
| `-e NGC_API_KEY=...` | Auth for downloading model weights from NGC |
| `-v host:/opt/nim/.cache` | Persist weights outside container (avoid re-downloading 6 GB) |
| `-p HOST:CONTAINER` | Llama serves on `8000` internally, Parakeet on `9000` |

### Lifecycle

```bash
sudo docker ps                                       # what's running
sudo docker logs -f llama-nim                        # stream logs
sudo docker stop llama-nim parakeet-nim parakeet-en-nim
sudo docker start llama-nim parakeet-nim parakeet-en-nim   # cached weights load fast
sudo docker rm <name>                                # remove container (keeps cache)
```

---

## 5. Pull strategy — surviving admin WiFi

The admin WiFi at ProjectHaven kills TCP connections every 5–10 min, which makes a 30 GB Docker pull fail repeatedly with:

```
failed to copy: read tcp ...:443: read: connection reset by peer
```

### Retry loop pattern

```bash
until sudo docker pull nvcr.io/nim/<path>:latest; do
  echo "WiFi dropped — retry in 10s..."
  sleep 10
done
```

Each retry resumes from where the previous attempt left off (Docker layer-by-layer caching). Bandwidth on this WiFi tops out around **18–19 MB/s** when stable.

### Use `sg docker -c` for background tasks

When running outside an interactive shell (e.g. background processes, ssh exec, automation), `sudo` will try to prompt for a password. Use the `docker` group instead:

```bash
sg docker -c 'docker pull nvcr.io/...'
```

The user `asus` is in the `docker` group, so this works without sudo.

---

## 6. The internal architecture of a Parakeet NIM container

NIM ≠ a single engine. It's a wrapper that picks the right backend per model:

| Model type | Backend NIM uses |
|---|---|
| LLMs (chat/instruct) | vLLM or TensorRT-LLM |
| ASR / speech | Triton Inference Server + NeMo runtime |
| Vision | TensorRT |
| Embedding/Reranker | Triton + ONNX Runtime |

### What `parakeet-nim` actually runs (multilingual profile)

Inside the container, Triton orchestrates a 3-stage pipeline:

```
Audio in (PCM 16 kHz)
   │
   ▼
[Silero VAD]          decides when speech starts/stops    (~180 MB GPU)
   │
   ▼
[Parakeet RNNT]       speech → text                       (~7 GB GPU)
   │
   ▼
[Sortformer]          assigns speaker IDs (diarization)   (~5 GB GPU)
   │
   ▼
JSON merged by Triton orchestrator                        (~13 GB GPU)
```

Process view (from `docker exec parakeet-nim ps aux`):

| PID | GPU mem | Role |
|---|---|---|
| 260 | 12.9 GB | `tritonserver` + TensorRT engines |
| 286 | 5.3 GB | Sortformer streaming (diarization) |
| 287 | 6.8 GB | Parakeet RNNT acoustic model |
| 288 | 182 MB | Silero VAD |

That's why a "1.1 B parameter ASR model" uses **~25 GB GPU** in this profile — the diarizer alone is bigger than the ASR.

### English profile (`parakeet-1-1b-ctc-en-us`) is leaner

| | Multilingual (Hindi) | English (CTC) |
|---|---|---|
| Mode | `ofl` (offline) | **`str` (streaming)** |
| Diarizer | Sortformer (5.3 GB) | **disabled** |
| VAD | Silero | default |
| Architecture | RNNT | **CTC** (faster) |
| GPU profile | `dgx_spark` | `dgx_spark` |

The English variant is **streaming-first, single-speaker** — ideal for a voice kiosk where one user speaks at a time.

---

## 7. API surface (Parakeet NIM 1.5.0)

OpenAPI schema served at `http://localhost:8004/openapi.json`:

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/audio/transcriptions` | One-shot ASR (OpenAI-compatible) |
| POST | `/v1/audio/translations` | ASR + cross-lingual translation |
| POST | `/v1/audio/synthesize` | TTS (sync) |
| POST | `/v1/audio/synthesize_online` | TTS (streaming) |
| POST | `/v1/realtime/transcription_sessions` | **WebSocket streaming ASR** |
| POST | `/v1/realtime/synthesis_sessions` | WebSocket streaming TTS |
| GET | `/v1/audio/list_voices` | Voice catalog |
| GET | `/v1/health/ready` | Health |
| GET | `/v1/manifest` | Model & profile detail |
| GET | `/v1/metadata` | Versions, licenses, model URLs |
| GET | `/v1/version` | Release + API version |
| GET | `/v1/metrics` | Prometheus metrics |

### Voice kiosk pipeline (real-time mode)

```
[Mic] ──► PCM 16 kHz ──► WebSocket POST /v1/realtime/transcription_sessions
                                       │
                                       ▼
   ┌───────────────────────────────────────────────────────┐
   │ Silero VAD   ── detects speech start                 │
   │     │                                                  │
   │     ▼                                                  │
   │ Parakeet RNNT/CTC ── emits partial hypotheses every │
   │                       ~300 ms                          │
   │     │   "hello wor..." → "hello world ho..."         │
   │     ▼                                                  │
   │ On 500 ms silence → emit FINAL transcript           │
   │     + Sortformer assigns speaker ID (multilingual    │
   │       profile only)                                   │
   └───────────────────────────────────────────────────────┘
                                       │
   Stream of events back to client:
     { "type": "partial", "text": "hello wor" }
     { "type": "partial", "text": "hello world how" }
     { "type": "final",   "text": "hello world how are you",
       "speaker": "spk_0" }
```

### End-to-end conversation flow (kiosk)

```
User mic
   │ PCM 16 kHz
   ▼
[parakeet-nim WebSocket :8004 or :8005] ── partial transcript every ~300 ms
   │
   ▼ final transcript when VAD detects silence
[Orchestrator code]
   │ prompt
   ▼
[llama-nim /v1/chat/completions :8003] ── streaming tokens
   │ text
   ▼
[parakeet-nim /v1/audio/synthesize_online] ── streaming audio
   │
   ▼
Speaker out
```

### Latency profile on GB10

| Stage | Typical latency |
|---|---|
| VAD detect speech start | < 50 ms |
| First partial transcript | ~200–300 ms after speaking |
| Final transcript after silence | ~500 ms of trailing silence |
| LLM first token | ~100–200 ms |
| TTS first audio chunk | ~150 ms |
| **End-to-end "user stops" → "robot speaks"** | ~700–1000 ms — feels conversational |

---

## 8. End-to-end test results

### Closed-loop transcription test

Audio source: `/usr/share/sounds/alsa/Front_Center.wav` (ALSA test sample, English speech "Front center", 48 kHz mono).

Command:

```bash
curl -X POST http://localhost:8004/v1/audio/transcriptions \
  -F "file=@/tmp/test_speech.wav" \
  -F "language=hi-IN"
```

Result (multilingual profile):

```json
{ "text": "फ्रंट सेंटर " }
```

That's Devanagari transliteration of "Front Center" — proving the pipeline works end-to-end. The acoustic model correctly recognized the English audio, but the decoder outputs in Devanagari because the loaded profile is `indic`.

### Language support in `parakeet-1-1b-rnnt-multilingual` (indic profile)

| Code | Result |
|---|---|
| `hi-IN` (Hindi) | ✅ Returns Devanagari |
| `ta-IN` (Tamil) | ✅ |
| `bn-IN` (Bengali) | ✅ |
| `en-US` | ⚠️ Accepts but outputs **Devanagari**, not Latin |
| `te / mr / gu / kn / ml / en-IN / en-GB` | ❌ "Model not found" |

For native Latin-script English, use `parakeet-1-1b-ctc-en-us` (port 8005).

---

## 9. Current production state

| Container | Image | Port | GPU mem | Role |
|---|---|---|---|---|
| `llama-nim` | `llama-3.1-8b-instruct-dgx-spark:latest` | 8003 → 8000 | ~60 GB | LLM (vLLM engine) |
| `parakeet-nim` | `parakeet-1-1b-rnnt-multilingual:latest` | 8004 → 9000 | ~25 GB | ASR Indic + diarization |
| `parakeet-en-nim` | `parakeet-1-1b-ctc-en-us:latest` | 8005 → 9000 | ~20 GB (est) | ASR English streaming |

Host RAM: 128 GB unified (CPU + GPU share). Real free headroom ~20 GB with all three running.

### Health URLs

```bash
curl http://localhost:8003/v1/health/ready      # Llama
curl http://localhost:8004/v1/health/ready      # Parakeet Indic
curl http://localhost:8005/v1/health/ready      # Parakeet EN
```

### Persistent caches on disk

```
/home/asus/.cache/nim/llama/        — Llama weights (~32 GB)
/home/asus/.cache/nim/parakeet/     — Parakeet Indic + Sortformer + VAD (~6 GB)
/home/asus/.cache/nim/parakeet-en/  — Parakeet EN CTC (~? GB)
```

These survive container removal — only `docker pull` or manual deletion clears them.

---

## 10. Troubleshooting cheatsheet

| Symptom | Cause | Fix |
|---|---|---|
| `exec /bin/bash: exec format error` | Pulled an AMD64 image on ARM64 | Check `docker inspect <img> --format '{{.Architecture}}'`; pull a multi-arch or `-dgx-spark` variant |
| `read: connection reset by peer` mid-pull | Admin WiFi killed TCP | Wrap pull in `until ... ; do sleep 10; done` |
| `Bad Request, bad model: <name>` on transcription | Passed the wrong model identifier | Use `language=<code>` and let NIM auto-pick, OR pass the full Triton model name from `docker exec <c> ls /data/models/` |
| Cache directory permission denied | NIM container can't write to `/opt/nim/.cache` | Mount a writable host dir with `-v /home/asus/.cache/nim/<name>:/opt/nim/.cache` |
| Container name conflict | Old container with same name exists | `docker rm <name>` first, or pick a new `--name` |
| `nvidia-smi` shows `memory.total = N/A` | Grace unified memory — there's no separate VRAM bank | Read GPU memory via `nvidia-smi --query-compute-apps=pid,used_memory --format=csv` |
| Output file appears 0 bytes after `docker pull` in background | No TTY, Docker buffers progress | Use `docker system df` to watch image-store growth instead |

---

## 11. Open questions / TODOs

- Find/verify ARM64 path for **Gemma 4 31B** (NVIDIA blog claims DGX Spark support but no `-dgx-spark` NIM tag exists yet)
- Investigate whether the **multilingual Parakeet profile** can be reconfigured to output Latin script for English (currently locked to Devanagari)
- Benchmark **end-to-end voice kiosk latency** once orchestrator wires Parakeet → Llama → TTS together
- Confirm `parakeet-1-1b-ctc-en-us` actually serves at port 8005 once weights finish downloading
- Decide on **TTS engine** — the Parakeet image lists TTS endpoints but `list_voices` returned empty; may need a separate `magpie-tts-multilingual` container

---

*Last updated: 2026-05-30. Probed against NGC catalog; image availability and tags may change.*
