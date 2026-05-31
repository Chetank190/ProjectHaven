# Haven Matrix — GPU & ML Learnings

> How the models run on the GPU, and an **honest** justification of where the GPU
> earns its keep vs. where it's a pattern that *scales* rather than a present
> necessity. Written for the NVIDIA Spark Hack Toronto (target: GX10, 128 GB
> unified memory).

---

## 1. The three GPU workloads

Haven Matrix puts three independent workloads on one device. They are very
different in how much they actually *need* a GPU.

| # | Workload | Library / model | GPU role | Honest verdict |
|---|----------|-----------------|----------|----------------|
| 1 | **LLM triage** — caseworker notes / kiosk speech → strict `NeedsPayload` JSON | Nemotron‑30B (llama.cpp) or Gemma 3n E4B (NIM) | Heavy matrix math, billions of params | **GPU is mandatory.** A 30B model is not CPU‑feasible at interactive latency. |
| 2 | **ASR** — voice → transcript on the kiosk | Parakeet‑1.1B‑TDT (NIM) | Real‑time audio inference | **GPU strongly justified.** Streaming STT at <1s needs it. |
| 3 | **Geospatial solve** — find nearest eligible services | cuML `NearestNeighbors` (haversine) + cuDF | KNN distance compute + dataframe masking | **GPU is a *scaling* story, not a present necessity** (see §4). |

The design principle (`CLAUDE.md`): **the LLM is a deterministic compiler, not a
decision‑maker.** Every GPU LLM call has a regex fallback, a strict Pydantic
output schema, and a CPU path. The GPU makes it *fast and natural*; the system
still *works* without it. That separation is what makes the GPU justification
honest rather than hand‑wavy.

---

## 2. How each model executes on the GPU

### LLM triage (`backend/nim_compiler.py`)
- 3‑tier endpoint cascade: NVIDIA cloud NIM → local llama.cpp Nemotron `:30000`
  → local Gemma NIM `:8001`, then **regex fallback** if all fail.
- `temperature=0.0`, `max_tokens=200` — we want a deterministic JSON object, not
  prose. The GPU is doing a *constrained extraction*, the cheapest possible use
  of an LLM.
- Output is validated by `NeedsPayload` (Pydantic). A hallucinated field is
  dropped, not trusted.

### ASR (`backend/main.py /transcribe`)
- Audio blob → Parakeet NIM `:9000` → transcript string. **Audio never leaves
  the device** when the local NIM is up (hard privacy boundary in `CLAUDE.md`).
- 3‑tier: local GPU NIM → cloud → browser Web Speech fallback.

### Geospatial solve (`backend/solver.py`)
- `cuDF` holds the datasets in GPU memory; eligibility masking (`has_id`,
  `sobriety_status`, sector, gender) runs as vectorized boolean ops on the GPU.
- `cuML NearestNeighbors(metric="haversine", algorithm="brute")` does the
  k‑nearest spatial query in radians; distances scaled by Earth radius (6371 km).
- A composite score (`0.60·distance + 0.30·occupancy + 0.10·transit`) re‑ranks
  candidates on the host (small K, cheap).
- `FORCE_CPU_SOLVER=1` swaps cuML→scikit‑learn and cuDF→pandas with **zero code
  change** at the call sites — the engine is selected by an enum.

---

## 3. Why the GX10 / unified memory is the right hardware

The genuine architectural win is **not** "KNN is faster on GPU." It's that the
GX10's **128 GB unified memory** lets all three workloads be *co‑resident*:

- A 30B LLM (~tens of GB), the ASR model, **and** every geospatial dataset live
  in the *same* memory space.
- cuDF ↔ cuML hand‑off is **zero‑copy** — no host↔device PCIe transfer between
  loading data and solving on it.
- One box runs the full pipeline **offline** (a demo hard‑requirement: "no live
  API calls during demo"). No cloud round‑trip, no data egress, PII stays local.

That co‑location + offline‑resilience is the story a CPU box or a
memory‑constrained discrete GPU can't tell.

---

## 4. The honest part: where the GPU does *not* yet pay off

Measured solve times (from `data/daily_telemetry.csv`) sit at **~12–135 ms** for
the full mask+KNN+score pipeline. At the **current data scale** (shelters in the
hundreds, the largest pillar ~1,600 respite rows, ~thousands of records total):

- The datasets fit comfortably in CPU cache. A brute‑force haversine KNN over a
  few thousand points is **microseconds of actual math**.
- Most of the measured millisecond cost is Python/cuDF **overhead and the
  host‑side scoring loop**, not the GPU kernel.
- For a *single* query, GPU vs CPU is effectively a wash; GPU launch overhead can
  even make CPU look better at this size.

**So why is it still the right call for the hackathon?**

1. **It's the same code that scales.** Swap Toronto's few‑thousand rows for a
   province‑wide or multi‑city dataset (10⁵–10⁷ points), add per‑query fan‑out
   for hundreds of concurrent kiosks, and the GPU KNN pulls decisively ahead
   while the CPU path degrades linearly.
2. **The GPU is already hot for the LLM + ASR.** Once the device is provisioned
   for workload #1 and #2, running the solve there too is *free marginal
   utilization* and keeps data zero‑copy beside the model.
3. **The benchmark is the demo artifact.** `solver.py --benchmark` and
   `/api/v1/benchmark` exist precisely to *show* the GPU/CPU delta live and
   honestly, rather than assert it.

> **Takeaway for judges:** the LLM and ASR are the load‑bearing GPU
> justification. The cuML solver is an honest demonstration of a GPU‑native data
> pattern that is *correct and ready* for scale, deployed today on small data
> for ~free because the accelerator is already in the box.

---

## 5. Measurement & fallback surfaces

| Surface | What it shows |
|---------|---------------|
| `solver.py --benchmark` | GPU vs CPU solve time + speedup, same payload |
| `GET /api/v1/benchmark` | last GPU/CPU solve ms + speedup ratio |
| `GET /api/v1/system` | live VRAM, GPU util %, temp via `pynvml` |
| `data/daily_telemetry.csv` | per‑request `gpu_solve_ms`, pillars, compile method |
| `FORCE_CPU_SOLVER` env | flips the entire solve to CPU with no code change |

Every GPU path degrades gracefully: LLM→regex, ASR→Web Speech, cuML→sklearn,
cuDF→pandas. **Resilience, not GPU‑dependence, is the engineering boast.**

---

## 6. One‑line justifications (for the pitch)

- *"A 30B local LLM and real‑time ASR are not CPU problems — that's the GPU
  mandate."*
- *"128 GB unified memory lets the model and the city's data share one address
  space, zero‑copy, fully offline."*
- *"The geospatial solver is GPU‑native so it scales from one city to a country
  without a rewrite — and it rides along for free on a GPU we already need."*
- *"Everything has a CPU fallback. The GPU makes it fast; it doesn't make it
  fragile."*

---

*See `learning/gpu_visualization.html` for the visual companion to this document.*
