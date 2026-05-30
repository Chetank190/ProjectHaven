"""
main.py
FastAPI application. All routes. Swagger at /docs.
Launch: uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
"""

import asyncio
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from config import EngineMode, KIOSK_HUBS, NIM_ENDPOINT
from data_ingestion import load_all
from nim_compiler import (
    NeedsPayload,
    compile_needs,
    generate_briefing,
    generate_handoff_script,
    kiosk_voice_payload,
)
from solver import solve
from voice_session import (
    VoiceSession,
    create_session,
    get_session,
    resolve_eligibility_questions,
    parse_eligibility_answer,
    clean_transcript,
    build_tts_itinerary_script,
    _cleanup_expired,
)

# ── Global state ──────────────────────────────────────────────────────────────
datasets_gpu: dict = {}
datasets_cpu: dict = {}
_last_benchmark: dict = {"gpu_ms": None, "cpu_ms": None}
_rapids_mode: str = "cpu"


@asynccontextmanager
async def lifespan(app: FastAPI):
    global datasets_gpu, datasets_cpu, _rapids_mode

    # Try GPU path first; fall back to CPU if RAPIDS unavailable (e.g. MacBook dev)
    try:
        datasets_gpu, _ = load_all(EngineMode.GPU)
        _rapids_mode = "gpu"
        print("[RAPIDS] GPU datasets loaded into unified memory.")
    except Exception as e:
        print(f"[WARN] GPU load failed ({e}). Running both paths on CPU.")
        datasets_gpu, _ = load_all(EngineMode.CPU)
        _rapids_mode = "cpu"

    datasets_cpu, _ = load_all(EngineMode.CPU)
    print(f"[READY] rapids_mode={_rapids_mode}")

    async def _session_gc():
        while True:
            await asyncio.sleep(60)
            _cleanup_expired()

    gc_task = asyncio.create_task(_session_gc())
    yield
    gc_task.cancel()


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Haven Matrix API",
    description=(
        "Dual-gateway social services triage. GPU-accelerated. Offline-resilient. "
        "Swagger at /docs."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

_cors_origins = os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


# ── Request models ────────────────────────────────────────────────────────────
class CaseworkerRouteRequest(BaseModel):
    text:        str
    origin_lat:  float = Field(43.6532, ge=-90, le=90)
    origin_lon:  float = Field(-79.3832, ge=-180, le=180)
    client_name: str | None = None


class KioskSessionRequest(BaseModel):
    transcript: str
    origin_lat: float = Field(..., ge=-90, le=90)
    origin_lon: float = Field(..., ge=-180, le=180)


class KioskRouteRequest(BaseModel):
    session_id:          str
    eligibility_answers: dict


class BriefingRequest(BaseModel):
    current_time_iso: str


class HandoffRequest(BaseModel):
    facility_name:  str
    facility_phone: str
    payload:        NeedsPayload


# ── Endpoints ─────────────────────────────────────────────────────────────────
@app.get("/api/v1/health")
async def health():
    return {
        "status":        "ok",
        "rapids_mode":   _rapids_mode,
        "nim_endpoint":  NIM_ENDPOINT,
        "datasets":      {k: len(v) for k, v in datasets_gpu.items()},
        "total_records": sum(len(v) for v in datasets_gpu.values()),
    }


@app.get("/api/v1/benchmark")
async def benchmark():
    gpu = _last_benchmark["gpu_ms"]
    cpu = _last_benchmark["cpu_ms"]
    return {
        "last_gpu_ms": gpu,
        "last_cpu_ms": cpu,
        "speedup":     round(cpu / gpu, 1) if (gpu and gpu > 0) else None,
    }


@app.post("/api/v1/caseworker/route")
async def caseworker_route(req: CaseworkerRouteRequest):
    try:
        cleaned = clean_transcript(req.text)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    payload, method, nim_ms = compile_needs(cleaned)
    origin = (req.origin_lat, req.origin_lon)

    # GPU solve (uses GPU datasets — may be CPU-backed on dev machines)
    gpu_mode = EngineMode.GPU if _rapids_mode == "gpu" else EngineMode.CPU
    itinerary_gpu, gpu_ms = solve(payload, datasets_gpu, origin, gpu_mode)

    # CPU benchmark in executor to avoid blocking the event loop
    loop = asyncio.get_event_loop()
    itinerary_cpu, cpu_ms = await loop.run_in_executor(
        None, solve, payload, datasets_cpu, origin, EngineMode.CPU
    )
    _last_benchmark.update({"gpu_ms": gpu_ms, "cpu_ms": cpu_ms})

    return {
        "payload":               payload.model_dump(),
        "compile_method":        method,
        "nim_latency_ms":        round(nim_ms, 1),
        "gpu_solve_ms":          round(gpu_ms, 2),
        "cpu_solve_ms":          round(cpu_ms, 2),
        "speedup":               round(cpu_ms / gpu_ms, 1) if gpu_ms > 0 else None,
        "itinerary":             itinerary_gpu,
        "ticket_text":           build_tts_itinerary_script(itinerary_gpu, req.client_name),
        "eligibility_questions": [],
    }


@app.post("/api/v1/kiosk/session")
async def kiosk_session(req: KioskSessionRequest):
    try:
        cleaned = clean_transcript(req.transcript)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    payload, _, _ = compile_needs(cleaned)
    session = create_session(payload, (req.origin_lat, req.origin_lon))
    questions = resolve_eligibility_questions(payload)

    return {
        "session_id":            session.session_id,
        "payload_draft":         payload.model_dump(),
        "eligibility_questions": questions,
        "next_step":             "collect_eligibility" if questions else "route",
    }


@app.post("/api/v1/kiosk/route")
async def kiosk_route(req: KioskRouteRequest):
    session = get_session(req.session_id)
    if not session or session.payload_draft is None:
        raise HTTPException(status_code=404, detail="Session expired or not found")

    draft = session.payload_draft.model_dump()
    draft.update({k: v for k, v in req.eligibility_answers.items() if v is not None})
    payload = NeedsPayload(**draft)

    gpu_mode = EngineMode.GPU if _rapids_mode == "gpu" else EngineMode.CPU
    itinerary, gpu_ms = solve(payload, datasets_gpu, session.origin, gpu_mode)

    loop = asyncio.get_event_loop()
    _, cpu_ms = await loop.run_in_executor(
        None, solve, payload, datasets_cpu, session.origin, EngineMode.CPU
    )
    _last_benchmark.update({"gpu_ms": gpu_ms, "cpu_ms": cpu_ms})

    return {
        "itinerary":    itinerary,
        "tts_script":   build_tts_itinerary_script(itinerary),
        "gpu_solve_ms": round(gpu_ms, 2),
    }


@app.post("/api/v1/caseworker/briefing")
async def caseworker_briefing(req: BriefingRequest):
    shelters = datasets_gpu.get("shelters")
    if shelters is None:
        raise HTTPException(status_code=503, detail="Shelter data not loaded")

    total, available, by_sector = 0, 0, {}
    try:
        pdf = shelters.to_pandas() if hasattr(shelters, "to_pandas") else shelters
        total     = int(pdf["CAPACITY_ACTUAL_BED"].sum())
        available = int(pdf["UNOCCUPIED_BEDS"].sum())
        by_sector = (
            pdf.groupby("SECTOR")["UNOCCUPIED_BEDS"]
            .sum()
            .astype(int)
            .to_dict()
        )
        summary = (
            f"Total beds: {total}. Available: {available}. "
            f"By sector: {by_sector}. Current time: {req.current_time_iso}."
        )
    except Exception as e:
        summary = f"Shelter data summary unavailable: {e}"

    briefing = generate_briefing(summary)
    return {
        "briefing_text":   briefing,
        "shelter_snapshot": {"total_beds": total, "available_beds": available},
    }


@app.post("/api/v1/handoff-script")
async def handoff_script(req: HandoffRequest):
    script = generate_handoff_script(req.facility_name, req.payload)
    return {
        "script":   script,
        "facility": req.facility_name,
        "phone":    req.facility_phone,
    }
