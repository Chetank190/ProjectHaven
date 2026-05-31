"""
main.py
FastAPI application. All routes. Swagger at /docs.
Launch: uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
"""

import asyncio
import json
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

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware

from config import (
    EngineMode, FORCE_CPU_SOLVER, KIOSK_HUBS, LOG_DIR, NIM_ENDPOINT, TELEMETRY_CSV,
    ASR_NIM_URL, ASR_CLOUD_URL, ASR_NIM_TIMEOUT, CASE_DB_PATH,
)
from case_store import CaseStore
from auth_store import AuthStore
from reservation_store import ReservationStore
from data_ingestion import load_all, fetch_weather_alert, get_weather_alert, refresh_shelters
from crisis_gate import is_crisis, build_escalation_reply
from guardrails_client import init_guardrails, check_input as guardrails_check
from pii_scrubber import has_injection
from nim_compiler import (
    NeedsPayload,
    compile_needs,
    compile_needs_async,
    generate_briefing_async,
    generate_handoff_script_async,
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
case_store:        CaseStore        | None = None
auth_store:        AuthStore        | None = None
reservation_store: ReservationStore | None = None


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
    global datasets_gpu, datasets_cpu, _rapids_mode, _telemetry_header_written, case_store, auth_store, reservation_store
    case_store        = CaseStore(str(CASE_DB_PATH))
    auth_store        = AuthStore(str(CASE_DB_PATH))
    reservation_store = ReservationStore(str(CASE_DB_PATH))

    _setup_logging()

    if FORCE_CPU_SOLVER:
        logger.info("[RAPIDS] FORCE_CPU_SOLVER=1 — routing on CPU; GPU reserved for LLM.")
        datasets_gpu, _ = load_all(EngineMode.CPU)
        _rapids_mode = "cpu"
    else:
        try:
            datasets_gpu, _ = load_all(EngineMode.GPU)
            _rapids_mode = "gpu"
            logger.info("[RAPIDS] GPU datasets loaded into unified memory.")
        except Exception as e:
            logger.warning(f"GPU load failed ({e}). Running both paths on CPU.")
            datasets_gpu, _ = load_all(EngineMode.CPU)
            _rapids_mode = "cpu"

    datasets_cpu, _ = load_all(EngineMode.CPU)

    # Fetch weather alert at startup without blocking the event loop
    await asyncio.to_thread(fetch_weather_alert)

    # Initialise NeMo Guardrails (optional — no-op if GUARDRAILS_ENABLED not set)
    guardrails_active = init_guardrails()
    logger.info(
        f"[READY] rapids_mode={_rapids_mode}  "
        f"weather={get_weather_alert()}  "
        f"guardrails={'active' if guardrails_active else 'disabled'}"
    )

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
            await asyncio.to_thread(fetch_weather_alert)
            # Shelter re-hydration every 4h — run both engines concurrently
            gpu_engine = EngineMode.GPU if _rapids_mode == "gpu" else EngineMode.CPU
            await asyncio.gather(
                asyncio.to_thread(refresh_shelters, datasets_gpu, gpu_engine),
                asyncio.to_thread(refresh_shelters, datasets_cpu, EngineMode.CPU),
            )

    gc_task  = asyncio.create_task(_session_gc())
    hyd_task = asyncio.create_task(_hydration_loop())
    yield
    gc_task.cancel()
    hyd_task.cancel()


# High-frequency polling paths that would drown signal at INFO level
_NOISY_PATHS = frozenset({
    "/api/v1/health", "/api/v1/benchmark",
    "/api/v1/system", "/api/v1/capacity",
})

# ── Request correlation middleware ────────────────────────────────────────────
class _ReqLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        rid = uuid.uuid4().hex[:6]
        request.state.rid = rid
        noisy = request.url.path in _NOISY_PATHS
        if not noisy:
            logger.info(f"[{rid}] → {request.method} {request.url.path}")
        t0 = time.perf_counter()
        response = await call_next(request)
        ms = (time.perf_counter() - t0) * 1000
        if noisy:
            logger.debug(f"[poll] {request.url.path} → {response.status_code} ({ms:.1f}ms)")
        else:
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

_cors_origins = os.environ.get("CORS_ORIGINS", "http://localhost:3001,http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
app.add_middleware(_ReqLogMiddleware)


# ── Request models ────────────────────────────────────────────────────────────
class CaseworkerRouteRequest(BaseModel):
    text:          str        = Field(..., max_length=5000)
    origin_lat:    float      = Field(43.6532, ge=-90, le=90)
    origin_lon:    float      = Field(-79.3832, ge=-180, le=180)
    client_name:   str | None = Field(None, max_length=100)
    caseworker_id: str | None = Field(None, max_length=80)


class OutcomeUpdateRequest(BaseModel):
    outcome: str = Field(..., pattern=r"^(pending|placed|declined|returned|referred_elsewhere)$")
    notes:   str = Field("", max_length=500)


class AuthRegisterRequest(BaseModel):
    email:    str = Field(..., max_length=120)
    name:     str = Field(..., min_length=1, max_length=80)
    password: str = Field(..., min_length=6, max_length=128)


class AuthLoginRequest(BaseModel):
    email:    str = Field(..., max_length=120)
    password: str = Field(..., max_length=128)


def _cw_id_from_request(request: Request, fallback: str | None) -> str | None:
    """Extract caseworker identity: JWT email takes priority over provided field."""
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer ") and auth_store:
        payload = AuthStore.decode_token(auth_header[7:])
        if payload and payload.get("sub"):
            return payload["sub"]
    return fallback


class KioskSessionRequest(BaseModel):
    transcript: str   = Field(..., max_length=2000)
    origin_lat: float = Field(..., ge=-90, le=90)
    origin_lon: float = Field(..., ge=-180, le=180)


class KioskRouteRequest(BaseModel):
    session_id:          str
    eligibility_answers: dict


class KioskReserveRequest(BaseModel):
    session_id:       str
    facility_name:    str = Field(..., max_length=200)
    facility_address: str = Field(..., max_length=300)
    pillar:           str = Field(..., max_length=40)


class BriefingRequest(BaseModel):
    current_time_iso: str


class HandoffRequest(BaseModel):
    facility_name:  str
    facility_phone: str
    payload:        NeedsPayload


def _briefing_stats(shelters_df, current_time_iso: str) -> tuple:
    """CPU-bound pandas aggregation extracted so it can run in a thread."""
    pdf = shelters_df.to_pandas() if hasattr(shelters_df, "to_pandas") else shelters_df
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
        f"By sector: {by_sector}. Current time: {current_time_iso}."
    )
    return total, available, summary


# ── ASR helper ────────────────────────────────────────────────────────────────
def _call_asr(base_url: str, audio_data: bytes, content_type: str) -> str:
    """Forward raw audio to an NVIDIA ASR NIM and return the transcript string."""
    import requests as _req
    ngc_key = os.environ.get("NGC_API_KEY", "not-needed")
    resp = _req.post(
        f"{base_url}/v1/audio/transcriptions",
        files={"file": ("recording", audio_data, content_type or "audio/webm")},
        data={"language": "en"},
        headers={"Authorization": f"Bearer {ngc_key}"},
        timeout=ASR_NIM_TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    # Parakeet NIM returns {"text": "..."}, OpenAI-compat also uses "text"
    return data.get("text") or data.get("transcript") or ""


# ── Endpoints ─────────────────────────────────────────────────────────────────
@app.get("/api/v1/health")
async def health():
    from guardrails_client import _rails as _gr_rails
    return {
        "status":           "ok",
        "rapids_mode":      _rapids_mode,
        "nim_endpoint":     NIM_ENDPOINT,
        "weather_alert":    get_weather_alert(),
        "datasets":         {k: len(v) for k, v in datasets_gpu.items()},
        "total_records":    sum(len(v) for v in datasets_gpu.values()),
        "nemo_guardrails":  "active" if _gr_rails is not None else "disabled",
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


class _ClientLogEvent(BaseModel):
    event:   str = Field(..., max_length=120)
    level:   str = Field("info", pattern=r"^(debug|info|warn|error)$")
    session: str | None = Field(None, max_length=32)
    data:    dict = {}


@app.post("/api/v1/client-log", status_code=204)
async def client_log(payload: _ClientLogEvent):
    """Receive structured log events from the browser and write them to the server log."""
    level_map = {"debug": logging.DEBUG, "info": logging.INFO,
                 "warn": logging.WARNING, "error": logging.ERROR}
    lv  = level_map.get(payload.level, logging.INFO)
    ctx = f" session={payload.session}" if payload.session else ""
    extra = f"  {payload.data}" if payload.data else ""
    logger.log(lv, f"[CLIENT] {payload.event}{ctx}{extra}")


@app.post("/api/v1/transcribe")
async def transcribe_audio(audio: UploadFile = File(...), request: Request = None):
    """
    Receive an audio blob from the kiosk, forward to ASR NIM, return transcript.
    3-tier: local Parakeet NIM → NVIDIA cloud ASR → 503 (browser falls back to Web Speech).
    Audio stays on-device when local NIM is running; cloud tier used only as last resort.
    """
    rid = getattr(request.state, "rid", "?") if request else "?"
    audio_data    = await audio.read()
    content_type  = audio.content_type or "audio/webm"
    logger.info(f"[{rid}] ASR request size={len(audio_data)}B type={content_type}")

    # Tier 1: local GPU NIM
    # Tier 2: NVIDIA cloud (only if NGC_API_KEY set — audio leaves device)
    ngc_key = os.environ.get("NGC_API_KEY", "")
    tiers = [(ASR_NIM_URL, "local")]
    if ngc_key:
        tiers.append((ASR_CLOUD_URL, "cloud"))

    for base_url, label in tiers:
        try:
            text = await asyncio.to_thread(
                _call_asr, base_url, audio_data, content_type
            )
            logger.info(f"[{rid}] ASR {label} OK: {len(text)} chars")
            return {"transcript": text, "source": label}
        except Exception as e:
            logger.warning(f"[{rid}] ASR {label} failed: {e}")

    logger.warning(f"[{rid}] ASR all tiers failed — client should fall back to Web Speech")
    raise HTTPException(status_code=503, detail="ASR unavailable — use browser fallback")


@app.post("/api/v1/caseworker/route")
async def caseworker_route(req: CaseworkerRouteRequest, request: Request):
    rid = getattr(request.state, "rid", "?")

    try:
        cleaned = clean_transcript(req.text)
    except ValueError as e:
        logger.warning(f"[{rid}] transcript rejected: {e}")
        raise HTTPException(status_code=400, detail=str(e))

    logger.debug(f"[{rid}] transcript accepted: {len(cleaned)} chars")

    if has_injection(cleaned):
        logger.warning(f"[{rid}] prompt injection attempt detected — blocking")
        raise HTTPException(status_code=400, detail="Input could not be processed. Please rephrase.")

    allowed, gr_reason = await guardrails_check(cleaned)
    if not allowed:
        logger.warning(f"[{rid}] NeMo Guardrails blocked input reason={gr_reason}")
        raise HTTPException(status_code=400, detail="Input could not be processed. Please rephrase.")
    logger.debug(f"[{rid}] guardrails={gr_reason}")

    # Crisis gate — deterministic regex, no network, runs before any LLM call
    crisis_detected, crisis_category = is_crisis(cleaned)
    if crisis_detected:
        logger.warning(f"[{rid}] crisis gate triggered category={crisis_category}")
        reply = build_escalation_reply(crisis_category)
        empty_payload = NeedsPayload(
            needs_shelter=False, needs_rehab=False, needs_food=False,
            needs_supplies=False, needs_hygiene=False,
        )
        return {
            **reply,
            "payload":               empty_payload.model_dump(),
            "compile_method":        "crisis_gate",
            "nim_latency_ms":        0,
            "gpu_solve_ms":          0,
            "cpu_solve_ms":          None,
            "speedup":               None,
            "itinerary":             {},
            "ticket_text":           reply["escalation_text"],
            "eligibility_questions": [],
        }

    cw_id = _cw_id_from_request(request, req.caseworker_id)

    # Pull similar resolved cases → inject as RAG context into the LLM prompt
    similar = case_store.find_similar(cleaned, limit=3) if case_store else []
    if similar:
        logger.info(f"[{rid}] injecting {len(similar)} similar cases into LLM context")

    # Returning-client hint — surface top match if strong enough
    returning_hint: dict | None = None
    if similar and similar[0]["similarity"] >= 0.35:
        top = similar[0]
        returning_hint = {
            "case_id":     top["id"],
            "last_seen":   top["created_at"][:10],
            "placed_at":   top.get("placed_at"),
            "outcome":     top["outcome"],
            "similarity":  top["similarity"],
            "client_name": top.get("client_name", ""),
        }

    payload, method, nim_ms = await compile_needs_async(cleaned, similar_cases=similar)
    logger.info(f"[{rid}] compile method={method} latency={nim_ms:.0f}ms")
    logger.info(f"[{rid}] payload {payload.model_dump()}")

    origin = (req.origin_lat, req.origin_lon)
    gpu_mode = EngineMode.GPU if _rapids_mode == "gpu" else EngineMode.CPU

    results = await asyncio.gather(
        asyncio.to_thread(solve, payload, datasets_gpu, origin, gpu_mode),
        asyncio.to_thread(solve, payload, datasets_cpu, origin, EngineMode.CPU),
        return_exceptions=True,
    )
    gpu_result, cpu_result = results

    if isinstance(gpu_result, Exception):
        logger.error(f"[{rid}] GPU solve failed: {gpu_result}", exc_info=True)
        raise HTTPException(status_code=500, detail="Routing engine error — please try again")

    itinerary_gpu, gpu_ms = gpu_result
    logger.info(
        f"[{rid}] gpu solve {gpu_ms:.1f}ms "
        f"results={' '.join(f'{k}:{len(v)}' for k,v in itinerary_gpu.items())}"
    )

    if isinstance(cpu_result, Exception):
        logger.warning(f"[{rid}] CPU benchmark failed: {cpu_result}")
        cpu_ms = None
    else:
        _, cpu_ms = cpu_result

    _last_benchmark.update({"gpu_ms": gpu_ms, "cpu_ms": cpu_ms})
    ticket = build_tts_itinerary_script(itinerary_gpu, req.client_name)

    asyncio.create_task(asyncio.to_thread(
        _log_telemetry, "caseworker", payload, method, gpu_ms, itinerary_gpu,
        req.origin_lat, req.origin_lon,
    ))

    # Persist case — fire-and-forget style (don't block the response)
    case_id: str | None = None
    if case_store and cw_id:
        try:
            case_id = case_store.save_case(
                caseworker_id=cw_id,
                client_name=req.client_name,
                transcript=cleaned,
                needs_payload=payload.model_dump(),
                itinerary=itinerary_gpu,
                ticket_text=ticket,
            )
        except Exception as exc:
            logger.warning(f"[{rid}] case_store.save_case failed: {exc}")

    return {
        "crisis":                False,
        "payload":               payload.model_dump(),
        "compile_method":        method,
        "nim_latency_ms":        round(nim_ms, 1),
        "gpu_solve_ms":          round(gpu_ms, 2),
        "cpu_solve_ms":          round(cpu_ms, 2) if cpu_ms is not None else None,
        "speedup":               round(cpu_ms / gpu_ms, 1) if (cpu_ms is not None and gpu_ms and gpu_ms > 0) else None,
        "itinerary":             itinerary_gpu,
        "ticket_text":           ticket,
        "eligibility_questions": [],
        "case_id":               case_id,
        "returning_hint":        returning_hint,
    }


@app.post("/api/v1/kiosk/session")
async def kiosk_session(req: KioskSessionRequest, request: Request):
    rid = getattr(request.state, "rid", "?")

    try:
        cleaned = clean_transcript(req.transcript)
    except ValueError as e:
        logger.warning(f"[{rid}] kiosk transcript rejected: {e}")
        raise HTTPException(status_code=400, detail=str(e))

    logger.debug(f"[{rid}] kiosk transcript accepted: {len(cleaned)} chars")

    allowed, gr_reason = await guardrails_check(cleaned)
    if not allowed:
        logger.warning(f"[{rid}] NeMo Guardrails blocked kiosk input reason={gr_reason}")
        raise HTTPException(status_code=400, detail="I'm sorry, I can't process that. Please tell me what you need.")
    logger.debug(f"[{rid}] guardrails={gr_reason}")

    # Crisis gate — deterministic regex, no network, runs before any LLM call
    crisis_detected, crisis_category = is_crisis(cleaned)
    if crisis_detected:
        logger.warning(f"[{rid}] kiosk crisis gate triggered category={crisis_category}")
        reply = build_escalation_reply(crisis_category)
        return {
            **reply,
            "session_id":            None,
            "payload_draft":         None,
            "eligibility_questions": [],
            "next_step":             "crisis",
        }

    payload, method, nim_ms = await compile_needs_async(cleaned)
    logger.info(f"[{rid}] kiosk compile method={method} latency={nim_ms:.0f}ms")
    logger.info(f"[{rid}] kiosk payload {payload.model_dump()}")

    session = create_session(payload, (req.origin_lat, req.origin_lon))
    questions = resolve_eligibility_questions(payload)
    logger.info(
        f"[{rid}] session={session.session_id} "
        f"questions={len(questions)} "
        f"next_step={'collect_eligibility' if questions else 'route'}"
    )

    return {
        "crisis":                False,
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
    # Log which fields the eligibility answers actually changed
    changed = {k: v for k, v in req.eligibility_answers.items()
               if v is not None and draft.get(k) != v}
    draft.update({k: v for k, v in req.eligibility_answers.items() if v is not None})
    payload = NeedsPayload(**draft)
    logger.info(
        f"[{rid}] kiosk eligibility_delta={changed or 'none'}  "
        f"gender={payload.gender}  sector={payload.sector}  "
        f"has_id={payload.has_id}  sobriety={payload.sobriety_status}  "
        f"group={payload.group_size}"
    )

    gpu_mode = EngineMode.GPU if _rapids_mode == "gpu" else EngineMode.CPU

    results = await asyncio.gather(
        asyncio.to_thread(solve, payload, datasets_gpu, session.origin, gpu_mode),
        asyncio.to_thread(solve, payload, datasets_cpu, session.origin, EngineMode.CPU),
        return_exceptions=True,
    )
    gpu_result, cpu_result = results

    if isinstance(gpu_result, Exception):
        logger.error(f"[{rid}] kiosk solve failed: {gpu_result}", exc_info=True)
        raise HTTPException(status_code=500, detail="Routing engine error — please try again")

    itinerary, gpu_ms = gpu_result
    # Build a compact summary: pillar → top result name + distance for log analysis
    summary = {
        pillar: f"{results[0]['name'][:30]} ({results[0]['distance_km']:.1f}km)"
        for pillar, results in itinerary.items() if results
    }
    logger.info(
        f"[{rid}] kiosk solve {gpu_ms:.1f}ms  "
        f"pillars={list(summary.keys())}  top={summary}"
    )

    if isinstance(cpu_result, Exception):
        logger.warning(f"[{rid}] kiosk CPU benchmark failed: {cpu_result}")
        cpu_ms = None
    else:
        _, cpu_ms = cpu_result

    _last_benchmark.update({"gpu_ms": gpu_ms, "cpu_ms": cpu_ms})
    asyncio.create_task(asyncio.to_thread(
        _log_telemetry, "kiosk", payload, "kiosk", gpu_ms, itinerary,
        session.origin[0], session.origin[1],
    ))

    return {
        "itinerary":    itinerary,
        "tts_script":   build_tts_itinerary_script(itinerary),
        "gpu_solve_ms": round(gpu_ms, 2),
    }


@app.post("/api/v1/kiosk/reserve")
async def kiosk_reserve(req: KioskReserveRequest, request: Request):
    rid = getattr(request.state, "rid", "?")
    if not reservation_store:
        raise HTTPException(status_code=503, detail="Reservation store not initialised")
    # Verify the session exists so codes can only be issued after a real route
    session = get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session expired or not found")
    try:
        result = reservation_store.create(
            session_id=req.session_id,
            facility_name=req.facility_name,
            facility_address=req.facility_address,
            pillar=req.pillar,
        )
    except Exception as exc:
        logger.error(f"[{rid}] reservation create failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail="Could not create reservation")
    logger.info(f"[{rid}] reservation code={result['code']} facility={req.facility_name!r}")
    return result


@app.get("/api/v1/kiosk/reserve/{code}")
async def kiosk_reserve_lookup(code: str):
    if not reservation_store:
        raise HTTPException(status_code=503, detail="Reservation store not initialised")
    result = reservation_store.lookup(code.upper())
    if result is None:
        raise HTTPException(status_code=404, detail="Reservation code not found")
    return result


@app.get("/api/v1/nearby")
async def nearby_services(lat: float, lon: float, radius_km: float = 2.0, limit: int = 60):
    """
    Return all services across all datasets within radius_km of (lat, lon),
    sorted by walking distance. Used by the kiosk Browse Nearby panel.
    No GPU, no KNN — simple Haversine in pandas.
    """
    if not datasets_cpu:
        raise HTTPException(status_code=503, detail="Datasets not loaded")
    if radius_km > 10:
        radius_km = 10.0

    import numpy as np
    import pandas as pd

    # Map dataset key → display pillar name
    PILLAR_MAP = {
        "shelters":    "shelter",
        "food":        "food",
        "grassroots":  "food",
        "rehab":       "rehab",
        "hygiene":     "hygiene",
        "youth_spaces":"youth",
        "libraries":   "library",
        "respite":     "respite",
    }
    NAME_COLS    = ["organization_name", "ORGANIZATION_NAME", "name"]
    ADDRESS_COLS = ["address", "SHELTER_ADDRESS", "LOCATION_ADDRESS"]

    R = 6371.0
    lat_r = np.radians(lat)
    lon_r = np.radians(lon)
    results = []

    for ds_key, pillar in PILLAR_MAP.items():
        df = datasets_cpu.get(ds_key)
        if df is None:
            continue
        try:
            pdf = df.to_pandas() if hasattr(df, "to_pandas") else df
            if pdf.empty:
                continue
            # Bounding-box pre-filter (≈ 10× faster than full haversine)
            lat_deg = radius_km / 111.0
            lon_deg = radius_km / (111.0 * np.cos(np.radians(lat)))
            box = pdf[
                (pdf["lat"].between(lat - lat_deg, lat + lat_deg)) &
                (pdf["lon"].between(lon - lon_deg, lon + lon_deg))
            ]
            if box.empty:
                continue
            # Exact Haversine
            dlat = np.radians(box["lat"].values - lat)
            dlon = np.radians(box["lon"].values - lon)
            a = np.sin(dlat / 2) ** 2 + np.cos(lat_r) * np.cos(np.radians(box["lat"].values)) * np.sin(dlon / 2) ** 2
            dist_km = R * 2 * np.arcsin(np.sqrt(a))
            within = dist_km <= radius_km
            box = box[within].copy()
            box["_dist_km"] = dist_km[within]
            if box.empty:
                continue

            for _, row in box.iterrows():
                name = next((str(row[c]) for c in NAME_COLS if c in row.index and row[c]), "Unknown")
                addr = next((str(row[c]) for c in ADDRESS_COLS if c in row.index and row[c]), "")
                d    = float(row["_dist_km"])
                results.append({
                    "pillar":             pillar,
                    "name":               name,
                    "address":            addr,
                    "lat":                float(row["lat"]),
                    "lon":                float(row["lon"]),
                    "distance_km":        round(d, 2),
                    "distance_walk_min":  int(round(d / 0.084)),
                    "hours":              str(row.get("hours", "")),
                    "phone":              str(row.get("phone", "")),
                    "requires_id":        bool(row.get("requires_id", False)),
                    "harm_reduction":     bool(row.get("harm_reduction", True)),
                    "transit_accessible": False,  # not computed here — kept fast
                    "open_now":           None,    # client-side filter optional
                    "bypass_pathway":     str(row.get("bypass_pathway", "")),
                    "intake_preparation": str(row.get("intake_preparation", "")),
                })
        except Exception as exc:
            logger.warning(f"[nearby] dataset={ds_key} error: {exc}")
            continue

    # Deduplicate by (name, address) keeping closest entry, then sort
    seen: set[tuple] = set()
    deduped = []
    for s in sorted(results, key=lambda x: x["distance_km"]):
        key = (s["name"].lower(), s["address"].lower())
        if key not in seen:
            seen.add(key)
            deduped.append(s)

    return {
        "services": deduped[:limit],
        "total":    len(deduped),
        "radius_km": radius_km,
    }


@app.post("/api/v1/caseworker/briefing")
async def caseworker_briefing(req: BriefingRequest, request: Request):
    rid = getattr(request.state, "rid", "?")
    shelters = datasets_gpu.get("shelters")
    if shelters is None:
        raise HTTPException(status_code=503, detail="Shelter data not loaded")

    total, available = 0, 0
    try:
        total, available, summary = await asyncio.to_thread(
            _briefing_stats, shelters, req.current_time_iso
        )
        logger.info(f"[{rid}] briefing total={total} available={available}")
    except Exception as e:
        logger.error(f"[{rid}] briefing data error: {e}", exc_info=True)
        summary = f"Shelter data summary unavailable: {e}"

    briefing = await generate_briefing_async(summary)
    return {
        "briefing_text":    briefing,
        "shelter_snapshot": {"total_beds": total, "available_beds": available},
    }


@app.post("/api/v1/handoff-script")
async def handoff_script(req: HandoffRequest, request: Request):
    rid = getattr(request.state, "rid", "?")
    logger.info(f"[{rid}] handoff facility={req.facility_name!r}")
    script = await generate_handoff_script_async(req.facility_name, req.payload)
    return {
        "script":   script,
        "facility": req.facility_name,
        "phone":    req.facility_phone,
    }


# ── Case history endpoints ─────────────────────────────────────────────────────

@app.get("/api/v1/caseworker/{caseworker_id}/history")
async def caseworker_history(caseworker_id: str):
    if not case_store:
        raise HTTPException(status_code=503, detail="Case store not initialised")
    cases = case_store.get_history(caseworker_id, limit=30)
    # Deserialise JSON blobs so the frontend gets plain objects
    for c in cases:
        if c.get("needs_json"):
            try:
                c["needs"] = json.loads(c.pop("needs_json"))
            except Exception:
                c["needs"] = None
                c.pop("needs_json", None)
        if c.get("itinerary_json"):
            try:
                c["itinerary"] = json.loads(c.pop("itinerary_json"))
            except Exception:
                c["itinerary"] = None
                c.pop("itinerary_json", None)
    return {"cases": cases, "total": len(cases)}


@app.patch("/api/v1/case/{case_id}/outcome")
async def update_case_outcome(case_id: str, req: OutcomeUpdateRequest):
    if not case_store:
        raise HTTPException(status_code=503, detail="Case store not initialised")
    ok = case_store.update_outcome(case_id, req.outcome, req.notes)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found")
    return {"case_id": case_id, "outcome": req.outcome}


# ── Auth endpoints ─────────────────────────────────────────────────────────────

@app.post("/api/v1/auth/register")
async def auth_register(req: AuthRegisterRequest):
    if not auth_store:
        raise HTTPException(status_code=503, detail="Auth store not initialised")
    try:
        user = auth_store.create_user(req.email, req.name, req.password)
    except ValueError as exc:
        # ValueError from duplicate email check
        raise HTTPException(status_code=409, detail=str(exc))
    except Exception as exc:
        logger.error(f"auth register failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail="Registration error — check server logs")
    token = auth_store.create_token(user)
    return {"token": token, "user": user}


@app.post("/api/v1/auth/login")
async def auth_login(req: AuthLoginRequest):
    if not auth_store:
        raise HTTPException(status_code=503, detail="Auth store not initialised")
    user = auth_store.authenticate(req.email, req.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = auth_store.create_token(user)
    return {"token": token, "user": user}


@app.get("/api/v1/auth/me")
async def auth_me(request: Request):
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    payload = AuthStore.decode_token(auth_header[7:])
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = auth_store.get_by_email(payload["sub"]) if auth_store else None
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


# ── Capacity endpoint (no LLM — fast poll target for the UI ticker) ────────────

@app.get("/api/v1/capacity")
async def capacity():
    if not datasets_gpu:
        raise HTTPException(status_code=503, detail="Datasets not loaded")
    shelters = datasets_gpu.get("shelters")
    if shelters is None:
        raise HTTPException(status_code=503, detail="Shelter data unavailable")
    try:
        import pandas as pd
        pdf = shelters.to_pandas() if hasattr(shelters, "to_pandas") else shelters
        total     = int(pdf["CAPACITY_ACTUAL_BED"].sum())
        available = int(pdf["UNOCCUPIED_BEDS"].sum())
        occupied  = total - available
        pct       = round(occupied / total * 100, 1) if total else 0.0
        return {
            "total_beds":     total,
            "available_beds": available,
            "occupied_beds":  occupied,
            "occupancy_pct":  pct,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
