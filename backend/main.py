"""
main.py
FastAPI application. All routes. Swagger at /docs.
Launch: uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
"""

import asyncio
import logging
import logging.handlers
import os
import sys
import time
import uuid
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware

from config import EngineMode, KIOSK_HUBS, LOG_DIR, NIM_ENDPOINT, TELEMETRY_CSV
from data_ingestion import load_all, fetch_weather_alert, get_weather_alert, refresh_shelters
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

logger = logging.getLogger(__name__)


def _setup_logging():
    """Configure root logger: timestamped daily file + console."""
    LOG_DIR.mkdir(exist_ok=True)
    fmt = logging.Formatter(
        "%(asctime)s | %(levelname)-8s | %(name)-14s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    fh = logging.handlers.TimedRotatingFileHandler(
        LOG_DIR / f"haven_{date.today()}.log",
        when="midnight", backupCount=7, encoding="utf-8",
    )
    fh.setFormatter(fmt)
    fh.setLevel(logging.DEBUG)
    ch = logging.StreamHandler()
    ch.setFormatter(fmt)
    ch.setLevel(logging.INFO)
    root = logging.getLogger()
    root.setLevel(logging.DEBUG)
    root.addHandler(fh)
    root.addHandler(ch)


# ── Global state ──────────────────────────────────────────────────────────────
datasets_gpu: dict = {}
datasets_cpu: dict = {}
_last_benchmark: dict = {"gpu_ms": None, "cpu_ms": None}
_rapids_mode: str = "cpu"
_telemetry_header_written: bool = False


def _log_telemetry(gateway: str, payload: NeedsPayload, compile_method: str,
                   gpu_solve_ms: float, itinerary: dict,
                   origin_lat: float, origin_lon: float) -> None:
    """Append one row to the Shadow Census telemetry CSV."""
    global _telemetry_header_written
    import csv as _csv
    from datetime import datetime, timezone
    needs = [k.replace("needs_", "") for k, v in payload.model_dump().items()
             if k.startswith("needs_") and v is True]
    row = {
        "timestamp":           datetime.now(timezone.utc).isoformat(),
        "gateway":             gateway,
        "needs_list":          "|".join(needs),
        "compile_method":      compile_method,
        "gpu_solve_ms":        round(gpu_solve_ms, 2),
        "pillars_returned":    "|".join(k for k, v in itinerary.items() if v),
        "origin_lat":          origin_lat,
        "origin_lon":          origin_lon,
        "weather_alert":       get_weather_alert() or "",
    }
    mode = "a" if _telemetry_header_written else "w"
    with open(TELEMETRY_CSV, mode, newline="") as f:
        writer = _csv.DictWriter(f, fieldnames=list(row.keys()))
        if mode == "w":
            writer.writeheader()
            _telemetry_header_written = True
        writer.writerow(row)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global datasets_gpu, datasets_cpu, _rapids_mode, _telemetry_header_written

    _setup_logging()

    try:
        datasets_gpu, _ = load_all(EngineMode.GPU)
        _rapids_mode = "gpu"
        logger.info("[RAPIDS] GPU datasets loaded into unified memory.")
    except Exception as e:
        logger.warning(f"GPU load failed ({e}). Running both paths on CPU.")
        datasets_gpu, _ = load_all(EngineMode.CPU)
        _rapids_mode = "cpu"

    datasets_cpu, _ = load_all(EngineMode.CPU)

    # Fetch weather alert at startup (500ms fail-safe)
    fetch_weather_alert()
    logger.info(f"[READY] rapids_mode={_rapids_mode}  weather={get_weather_alert()}")

    # Initialise telemetry CSV header
    if not TELEMETRY_CSV.exists():
        _telemetry_header_written = False
    else:
        _telemetry_header_written = True

    async def _session_gc():
        while True:
            await asyncio.sleep(60)
            _cleanup_expired()

    async def _hydration_loop():
        """Refresh shelters every 4 hours + weather every 30 min."""
        while True:
            await asyncio.sleep(30 * 60)  # 30 min
            fetch_weather_alert()
            await asyncio.sleep(0)
            # Shelter re-hydration every 4h
            refresh_shelters(datasets_gpu, EngineMode.GPU if _rapids_mode == "gpu" else EngineMode.CPU)
            refresh_shelters(datasets_cpu, EngineMode.CPU)

    gc_task  = asyncio.create_task(_session_gc())
    hyd_task = asyncio.create_task(_hydration_loop())
    yield
    gc_task.cancel()
    hyd_task.cancel()


# ── Request correlation middleware ────────────────────────────────────────────
class _ReqLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        rid = uuid.uuid4().hex[:6]
        request.state.rid = rid
        logger.info(f"[{rid}] → {request.method} {request.url.path}")
        t0 = time.perf_counter()
        response = await call_next(request)
        ms = (time.perf_counter() - t0) * 1000
        logger.info(f"[{rid}] ← {response.status_code} in {ms:.1f}ms")
        return response


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
app.add_middleware(_ReqLogMiddleware)


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
        "weather_alert": get_weather_alert(),
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


@app.get("/api/v1/system")
async def system_stats():
    """Live GPU utilization via pynvml (available on GX10; graceful on dev machines)."""
    gpu_info = None
    try:
        import pynvml
        pynvml.nvmlInit()
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        mem    = pynvml.nvmlDeviceGetMemoryInfo(handle)
        util   = pynvml.nvmlDeviceGetUtilizationRates(handle)
        temp   = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
        gpu_info = {
            "vram_used_gb":        round(mem.used  / 1e9, 2),
            "vram_total_gb":       round(mem.total / 1e9, 2),
            "vram_free_gb":        round(mem.free  / 1e9, 2),
            "gpu_utilization_pct": util.gpu,
            "temperature_c":       temp,
        }
        pynvml.nvmlShutdown()
    except Exception:
        pass
    return {"gpu_info": gpu_info, "weather_alert": get_weather_alert()}


@app.get("/api/v1/telemetry/summary")
async def telemetry_summary():
    """Aggregate Shadow Census stats from daily_telemetry.csv."""
    if not TELEMETRY_CSV.exists():
        return {"total_routes": 0, "message": "No telemetry recorded yet."}
    try:
        import csv as _csv
        from collections import Counter
        rows = []
        with open(TELEMETRY_CSV) as f:
            reader = _csv.DictReader(f)
            rows = list(reader)
        if not rows:
            return {"total_routes": 0}
        pillar_counts: Counter = Counter()
        gpu_times = []
        gateways: Counter = Counter()
        for r in rows:
            for p in r.get("pillars_returned", "").split("|"):
                if p:
                    pillar_counts[p] += 1
            try:
                gpu_times.append(float(r["gpu_solve_ms"]))
            except (KeyError, ValueError):
                pass
            gateways[r.get("gateway", "unknown")] += 1
        return {
            "total_routes":          len(rows),
            "gateway_breakdown":     dict(gateways),
            "most_requested_pillar": pillar_counts.most_common(1)[0] if pillar_counts else None,
            "pillar_request_counts": dict(pillar_counts),
            "avg_gpu_solve_ms":      round(sum(gpu_times) / len(gpu_times), 2) if gpu_times else None,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/caseworker/route")
async def caseworker_route(req: CaseworkerRouteRequest, request: Request):
    rid = getattr(request.state, "rid", "?")

    try:
        cleaned = clean_transcript(req.text)
    except ValueError as e:
        logger.warning(f"[{rid}] transcript rejected: {e}")
        raise HTTPException(status_code=400, detail=str(e))

    logger.debug(f"[{rid}] transcript: {cleaned[:120]!r}")
    payload, method, nim_ms = compile_needs(cleaned)
    logger.info(f"[{rid}] compile method={method} latency={nim_ms:.0f}ms")
    logger.info(f"[{rid}] payload {payload.model_dump()}")

    origin = (req.origin_lat, req.origin_lon)
    gpu_mode = EngineMode.GPU if _rapids_mode == "gpu" else EngineMode.CPU

    try:
        itinerary_gpu, gpu_ms = solve(payload, datasets_gpu, origin, gpu_mode)
        logger.info(
            f"[{rid}] gpu solve {gpu_ms:.1f}ms "
            f"results={' '.join(f'{k}:{len(v)}' for k,v in itinerary_gpu.items())}"
        )
    except Exception as e:
        logger.error(f"[{rid}] GPU solve failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Routing engine error — please try again")

    loop = asyncio.get_event_loop()
    try:
        itinerary_cpu, cpu_ms = await loop.run_in_executor(
            None, solve, payload, datasets_cpu, origin, EngineMode.CPU
        )
    except Exception as e:
        logger.warning(f"[{rid}] CPU benchmark failed: {e}")
        cpu_ms = None
    _last_benchmark.update({"gpu_ms": gpu_ms, "cpu_ms": cpu_ms})
    _log_telemetry("caseworker", payload, method, gpu_ms, itinerary_gpu,
                   req.origin_lat, req.origin_lon)

    return {
        "payload":               payload.model_dump(),
        "compile_method":        method,
        "nim_latency_ms":        round(nim_ms, 1),
        "gpu_solve_ms":          round(gpu_ms, 2),
        "cpu_solve_ms":          round(cpu_ms, 2) if cpu_ms is not None else None,
        "speedup":               round(cpu_ms / gpu_ms, 1) if (cpu_ms is not None and gpu_ms and gpu_ms > 0) else None,
        "itinerary":             itinerary_gpu,
        "ticket_text":           build_tts_itinerary_script(itinerary_gpu, req.client_name),
        "eligibility_questions": [],
    }


@app.post("/api/v1/kiosk/session")
async def kiosk_session(req: KioskSessionRequest, request: Request):
    rid = getattr(request.state, "rid", "?")

    try:
        cleaned = clean_transcript(req.transcript)
    except ValueError as e:
        logger.warning(f"[{rid}] kiosk transcript rejected: {e}")
        raise HTTPException(status_code=400, detail=str(e))

    logger.debug(f"[{rid}] kiosk transcript: {cleaned[:120]!r}")
    payload, method, nim_ms = compile_needs(cleaned)
    logger.info(f"[{rid}] kiosk compile method={method} latency={nim_ms:.0f}ms")
    logger.info(f"[{rid}] kiosk payload {payload.model_dump()}")

    session = create_session(payload, (req.origin_lat, req.origin_lon))
    questions = resolve_eligibility_questions(payload)
    logger.info(f"[{rid}] session={session.session_id} questions={len(questions)}")

    return {
        "session_id":            session.session_id,
        "payload_draft":         payload.model_dump(),
        "eligibility_questions": questions,
        "next_step":             "collect_eligibility" if questions else "route",
    }


@app.post("/api/v1/kiosk/route")
async def kiosk_route(req: KioskRouteRequest, request: Request):
    rid = getattr(request.state, "rid", "?")
    logger.info(f"[{rid}] kiosk route session={req.session_id} answers={req.eligibility_answers}")

    session = get_session(req.session_id)
    if not session or session.payload_draft is None:
        logger.warning(f"[{rid}] session not found or expired: {req.session_id}")
        raise HTTPException(status_code=404, detail="Session expired or not found")

    draft = session.payload_draft.model_dump()
    draft.update({k: v for k, v in req.eligibility_answers.items() if v is not None})
    payload = NeedsPayload(**draft)
    logger.info(f"[{rid}] kiosk merged payload {payload.model_dump()}")

    gpu_mode = EngineMode.GPU if _rapids_mode == "gpu" else EngineMode.CPU

    try:
        itinerary, gpu_ms = solve(payload, datasets_gpu, session.origin, gpu_mode)
        logger.info(
            f"[{rid}] kiosk solve {gpu_ms:.1f}ms "
            f"results={' '.join(f'{k}:{len(v)}' for k,v in itinerary.items())}"
        )
    except Exception as e:
        logger.error(f"[{rid}] kiosk solve failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Routing engine error — please try again")

    loop = asyncio.get_event_loop()
    try:
        _, cpu_ms = await loop.run_in_executor(
            None, solve, payload, datasets_cpu, session.origin, EngineMode.CPU
        )
    except Exception as e:
        logger.warning(f"[{rid}] kiosk CPU benchmark failed: {e}")
        cpu_ms = None
    _last_benchmark.update({"gpu_ms": gpu_ms, "cpu_ms": cpu_ms})
    _log_telemetry("kiosk", payload, "kiosk", gpu_ms, itinerary,
                   session.origin[0], session.origin[1])

    return {
        "itinerary":    itinerary,
        "tts_script":   build_tts_itinerary_script(itinerary),
        "gpu_solve_ms": round(gpu_ms, 2),
    }


@app.post("/api/v1/caseworker/briefing")
async def caseworker_briefing(req: BriefingRequest, request: Request):
    rid = getattr(request.state, "rid", "?")
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
        logger.info(f"[{rid}] briefing total={total} available={available}")
    except Exception as e:
        logger.error(f"[{rid}] briefing data error: {e}", exc_info=True)
        summary = f"Shelter data summary unavailable: {e}"

    briefing = generate_briefing(summary)
    return {
        "briefing_text":    briefing,
        "shelter_snapshot": {"total_beds": total, "available_beds": available},
    }


@app.post("/api/v1/handoff-script")
async def handoff_script(req: HandoffRequest, request: Request):
    rid = getattr(request.state, "rid", "?")
    logger.info(f"[{rid}] handoff facility={req.facility_name!r}")
    script = generate_handoff_script(req.facility_name, req.payload)
    return {
        "script":   script,
        "facility": req.facility_name,
        "phone":    req.facility_phone,
    }
