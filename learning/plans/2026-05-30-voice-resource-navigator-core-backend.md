# Voice-Input Resource Navigator — Core Conversation Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **GIT DISABLED:** Per user instruction, this project uses **no git**. Every task ends with a **Checkpoint** step (run lint + tests) instead of a commit. Do not run any `git` commands.

**Goal:** Build the testable core backend that turns recorded audio into a grounded, safe reply: audio → ASR → deterministic crisis gate → structured retrieval over a verified resource directory → grounded LLM response.

**Architecture:** A FastAPI service. A hybrid orchestrator runs a deterministic crisis gate first (plain Python), then a bounded one-tool agent that (a) asks the LLM to emit a structured `ResourceQuery`, (b) executes a structured filter over the resource repository (geo distance from the fixed kiosk + open-now + eligibility), then (c) asks the LLM to compose a reply that may only cite retrieved records. All external models (Parakeet ASR NIM, Gemma LLM NIM) sit behind thin client interfaces and are mocked in tests.

**Tech Stack:** Python 3.12, `uv` (Bell Artifactory index), `ruff`, `pytest` (`unit`/`integration` markers), Pydantic v2 + pydantic-settings, FastAPI + Starlette TestClient, `httpx` (NIM clients), `psycopg` (Postgres adapter). NeMo Agent toolkit wraps the agent for eval/observability (Task 15).

**Scope — this is Plan 1 of 5.** Follow-on plans (not covered here):
- Plan 2 — Resource data pipeline (ingest 211 / municipal open data + partner feeds → Postgres; freshness/staleness).
- Plan 3 — Infra/deployment (Parakeet, Gemma, NeMo Retriever NIMs; Postgres/Milvus on the GX10).
- Plan 4 — Kiosk frontend (push-to-talk UI, screen output, optional TTS).
- Plan 5 — Eval harness (ASR bake-off, retrieval precision/recall, crisis recall) via NeMo Agent toolkit evaluation.

---

## File Structure

```
voice-resource-navigator/
  pyproject.toml                  # uv project, Artifactory index, ruff, pytest markers
  .env.example                    # documented config (no secrets committed)
  src/vrn/
    __init__.py
    config.py                     # Settings (pydantic-settings, os.getenv)
    logging_config.py             # structured JSON logging
    models/
      __init__.py
      resource.py                 # ResourceRecord + enums/sub-models
      conversation.py             # TranscriptionResult, CrisisResult, ResourceMatch, Reply, ResourceQuery
    geo.py                        # haversine distance
    hours.py                      # open-now evaluation
    retrieval/
      __init__.py
      filter.py                   # pure structured filter (query -> matches)
      repository.py               # ResourceRepository protocol + InMemory + Postgres adapters
    safety/
      __init__.py
      crisis_gate.py              # deterministic crisis detection (high recall)
      escalation.py               # hotline content + escalation Reply builder
    asr/
      __init__.py
      base.py                     # ASRClient protocol
      parakeet_nim.py             # Parakeet NIM client (httpx)
    llm/
      __init__.py
      base.py                     # LLMClient protocol + LLMResponse/ToolCall
      nim_client.py               # OpenAI-compatible NIM client (httpx)
      prompts.py                  # system prompt + grounding rules
    agent/
      __init__.py
      tools.py                    # find_resources tool
      orchestrator.py             # hybrid gate -> bounded agent -> grounded reply
    api/
      __init__.py
      app.py                      # FastAPI app + dependency wiring
  nemo/
    workflow.yaml                 # NeMo Agent toolkit workflow (Task 15)
  tests/
    conftest.py
    unit/
      test_geo.py
      test_hours.py
      test_filter.py
      test_crisis_gate.py
      test_escalation.py
      test_parakeet_nim.py
      test_nim_client.py
      test_tools.py
      test_orchestrator.py
    integration/
      test_converse_endpoint.py
```

---

## Task 1: Project scaffold, config, and structured logging

**Files:**
- Create: `pyproject.toml`, `.env.example`, `src/vrn/__init__.py`, `src/vrn/config.py`, `src/vrn/logging_config.py`, `tests/conftest.py`, `tests/unit/__init__.py`

- [ ] **Step 1: Create `pyproject.toml`**

```toml
[project]
name = "voice-resource-navigator"
version = "0.1.0"
description = "Voice-input resource navigator core backend"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn>=0.32",
    "httpx>=0.27",
    "pydantic>=2.9",
    "pydantic-settings>=2.5",
    "psycopg[binary]>=3.2",
    "python-multipart>=0.0.12",
]

[dependency-groups]
dev = ["pytest>=8.3", "pytest-asyncio>=0.24", "ruff>=0.7"]

[[tool.uv.index]]
url = "https://artifactory.int.bell.ca/artifactory/api/pypi/shared-pip-remote/simple"
default = true

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B"]

[tool.pytest.ini_options]
markers = [
    "unit: fast isolated tests with all externals mocked",
    "integration: end-to-end tests with test fixtures",
]
pythonpath = ["src"]
asyncio_mode = "auto"

[tool.hatch.build.targets.wheel]
packages = ["src/vrn"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

- [ ] **Step 2: Create `.env.example`**

```bash
# No secrets in source. Copy to .env locally; production uses GCP Secret Manager.
VRN_SERVICE_NAME=voice-resource-navigator
VRN_LOG_LEVEL=INFO
VRN_ASR_NIM_URL=http://localhost:9000
VRN_LLM_NIM_URL=http://localhost:8000/v1
VRN_LLM_MODEL=google/gemma-4-26b-a4b
VRN_DATABASE_URL=postgresql://vrn:vrn@localhost:5432/vrn
VRN_KIOSK_LAT=43.6532
VRN_KIOSK_LNG=-79.3832
VRN_MAX_DISTANCE_KM=10.0
VRN_STALE_AFTER_DAYS=14
```

- [ ] **Step 3: Create `src/vrn/__init__.py`**

```python
__all__: list[str] = []
```

- [ ] **Step 4: Write `src/vrn/config.py`**

```python
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VRN_", env_file=".env", extra="ignore")

    service_name: str = "voice-resource-navigator"
    log_level: str = "INFO"
    asr_nim_url: str = "http://localhost:9000"
    llm_nim_url: str = "http://localhost:8000/v1"
    llm_model: str = "google/gemma-4-26b-a4b"
    database_url: str = "postgresql://vrn:vrn@localhost:5432/vrn"
    kiosk_lat: float = 43.6532
    kiosk_lng: float = -79.3832
    max_distance_km: float = 10.0
    stale_after_days: int = 14


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 5: Write `src/vrn/logging_config.py`**

```python
import json
import logging
import sys
from datetime import datetime, timezone


class JsonFormatter(logging.Formatter):
    def __init__(self, service_name: str) -> None:
        super().__init__()
        self._service_name = service_name

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", "-"),
            "service_name": self._service_name,
        }
        return json.dumps(payload)


def configure_logging(service_name: str, level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter(service_name))
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
```

- [ ] **Step 6: Write `tests/conftest.py`**

```python
import pytest


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("VRN_KIOSK_LAT", "43.6532")
    monkeypatch.setenv("VRN_KIOSK_LNG", "-79.3832")
```

Also create empty `tests/unit/__init__.py`.

- [ ] **Step 7: Checkpoint**

Run: `uv sync && uv run ruff check src tests`
Expected: dependencies install; ruff reports no errors.

---

## Task 2: Resource domain models

**Files:**
- Create: `src/vrn/models/__init__.py`, `src/vrn/models/resource.py`
- Test: `tests/unit/test_models.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_models.py
import datetime as dt

import pytest

from vrn.models.resource import (
    Eligibility,
    Geo,
    OpenPeriod,
    OpeningHours,
    ResourceRecord,
    ResourceStatus,
    ResourceType,
)


@pytest.mark.unit
def test_resource_record_round_trips():
    record = ResourceRecord(
        id="shelter-1",
        name="Downtown Shelter",
        type=ResourceType.SHELTER,
        geo=Geo(lat=43.65, lng=-79.38),
        address="1 Main St",
        hours=OpeningHours(periods=[OpenPeriod(weekday=0, open="20:00", close="08:00")]),
        eligibility=Eligibility(family_ok=True),
        phone="416-555-0100",
        languages=["en"],
        accessibility=["wheelchair"],
        source="211",
        last_verified=dt.datetime(2026, 5, 1, tzinfo=dt.timezone.utc),
        status=ResourceStatus.OPEN,
    )
    assert record.type is ResourceType.SHELTER
    assert record.eligibility.family_ok is True
    assert ResourceRecord.model_validate(record.model_dump()) == record
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_models.py -v`
Expected: FAIL — `ModuleNotFoundError: vrn.models.resource`.

- [ ] **Step 3: Write `src/vrn/models/__init__.py` and `src/vrn/models/resource.py`**

```python
# src/vrn/models/__init__.py
__all__: list[str] = []
```

```python
# src/vrn/models/resource.py
import datetime as dt
from enum import Enum

from pydantic import BaseModel, Field


class ResourceType(str, Enum):
    SHELTER = "shelter"
    FOOD = "food"
    HOSPITAL = "hospital"
    CLINIC = "clinic"
    DROP_IN = "dropin"


class ResourceStatus(str, Enum):
    OPEN = "open"
    CLOSED = "closed"
    UNKNOWN = "unknown"


class Geo(BaseModel):
    lat: float
    lng: float


class OpenPeriod(BaseModel):
    weekday: int = Field(ge=0, le=6, description="0=Monday .. 6=Sunday")
    open: dt.time
    close: dt.time


class OpeningHours(BaseModel):
    periods: list[OpenPeriod] = Field(default_factory=list)
    always_open: bool = False


class Eligibility(BaseModel):
    gender: str | None = None
    min_age: int | None = None
    max_age: int | None = None
    family_ok: bool = True
    sobriety_required: bool = False
    referral_required: bool = False


class ResourceRecord(BaseModel):
    id: str
    name: str
    type: ResourceType
    geo: Geo
    address: str
    hours: OpeningHours
    eligibility: Eligibility
    capacity: int | None = None
    phone: str | None = None
    languages: list[str] = Field(default_factory=list)
    accessibility: list[str] = Field(default_factory=list)
    source: str
    last_verified: dt.datetime
    status: ResourceStatus = ResourceStatus.UNKNOWN
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_models.py -v`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `uv run ruff check src tests && uv run pytest -q`
Expected: ruff clean; all tests pass.

---

## Task 3: Geo distance utility

**Files:**
- Create: `src/vrn/geo.py`
- Test: `tests/unit/test_geo.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_geo.py
import pytest

from vrn.geo import haversine_km
from vrn.models.resource import Geo


@pytest.mark.unit
def test_haversine_zero_distance():
    p = Geo(lat=43.65, lng=-79.38)
    assert haversine_km(p, p) == pytest.approx(0.0, abs=1e-6)


@pytest.mark.unit
def test_haversine_known_distance():
    # Toronto City Hall -> Union Station ~ 1.0 km
    a = Geo(lat=43.6534, lng=-79.3841)
    b = Geo(lat=43.6453, lng=-79.3806)
    assert haversine_km(a, b) == pytest.approx(0.95, abs=0.2)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_geo.py -v`
Expected: FAIL — `ModuleNotFoundError: vrn.geo`.

- [ ] **Step 3: Write `src/vrn/geo.py`**

```python
import math

from vrn.models.resource import Geo

_EARTH_RADIUS_KM = 6371.0088


def haversine_km(a: Geo, b: Geo) -> float:
    lat1, lat2 = math.radians(a.lat), math.radians(b.lat)
    dlat = math.radians(b.lat - a.lat)
    dlng = math.radians(b.lng - a.lng)
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * _EARTH_RADIUS_KM * math.asin(math.sqrt(h))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_geo.py -v`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `uv run ruff check src tests && uv run pytest -q`
Expected: ruff clean; all tests pass.

---

## Task 4: Open-now hours evaluation

**Files:**
- Create: `src/vrn/hours.py`
- Test: `tests/unit/test_hours.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_hours.py
import datetime as dt

import pytest

from vrn.hours import is_open_at
from vrn.models.resource import OpeningHours, OpenPeriod


@pytest.mark.unit
def test_always_open_is_open():
    assert is_open_at(OpeningHours(always_open=True), dt.datetime(2026, 5, 30, 3, 0)) is True


@pytest.mark.unit
def test_same_day_window():
    hours = OpeningHours(periods=[OpenPeriod(weekday=4, open="09:00", close="17:00")])
    # 2026-05-29 is a Friday (weekday=4)
    assert is_open_at(hours, dt.datetime(2026, 5, 29, 10, 0)) is True
    assert is_open_at(hours, dt.datetime(2026, 5, 29, 18, 0)) is False


@pytest.mark.unit
def test_overnight_window_crosses_midnight():
    # Shelter open Fri 20:00 -> Sat 08:00
    hours = OpeningHours(periods=[OpenPeriod(weekday=4, open="20:00", close="08:00")])
    assert is_open_at(hours, dt.datetime(2026, 5, 29, 23, 0)) is True   # Fri night
    assert is_open_at(hours, dt.datetime(2026, 5, 30, 7, 0)) is True    # Sat morning
    assert is_open_at(hours, dt.datetime(2026, 5, 30, 9, 0)) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_hours.py -v`
Expected: FAIL — `ModuleNotFoundError: vrn.hours`.

- [ ] **Step 3: Write `src/vrn/hours.py`**

```python
import datetime as dt

from vrn.models.resource import OpeningHours, OpenPeriod


def _matches(period: OpenPeriod, when: dt.datetime) -> bool:
    t = when.time()
    if period.open <= period.close:
        # Same-day window
        return period.weekday == when.weekday() and period.open <= t < period.close
    # Overnight window crossing midnight
    if period.weekday == when.weekday() and t >= period.open:
        return True
    prev_day = (when.weekday() - 1) % 7
    return period.weekday == prev_day and t < period.close


def is_open_at(hours: OpeningHours, when: dt.datetime) -> bool:
    if hours.always_open:
        return True
    return any(_matches(p, when) for p in hours.periods)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_hours.py -v`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `uv run ruff check src tests && uv run pytest -q`
Expected: ruff clean; all tests pass.

---

## Task 5: Conversation models + structured filter

**Files:**
- Create: `src/vrn/models/conversation.py`, `src/vrn/retrieval/__init__.py`, `src/vrn/retrieval/filter.py`
- Test: `tests/unit/test_filter.py`

- [ ] **Step 1: Write `src/vrn/models/conversation.py`** (support code for the test)

```python
# src/vrn/models/conversation.py
from pydantic import BaseModel, Field

from vrn.models.resource import ResourceRecord, ResourceType


class TranscriptionResult(BaseModel):
    text: str
    confidence: float = 1.0
    language: str = "en"


class ResourceQuery(BaseModel):
    """Structured query the bounded agent emits from the user's utterance."""

    type: ResourceType | None = None
    open_now: bool = False
    require_family_ok: bool = False
    gender: str | None = None
    max_distance_km: float | None = None


class ResourceMatch(BaseModel):
    record: ResourceRecord
    distance_km: float
    stale: bool = False


class CrisisResult(BaseModel):
    is_crisis: bool = False
    category: str | None = None
    matched: list[str] = Field(default_factory=list)


class Reply(BaseModel):
    message: str
    matches: list[ResourceMatch] = Field(default_factory=list)
    is_crisis: bool = False
    escalated: bool = False
    fallback: bool = False
```

- [ ] **Step 2: Write the failing test**

```python
# tests/unit/test_filter.py
import datetime as dt

import pytest

from vrn.models.conversation import ResourceQuery
from vrn.models.resource import (
    Eligibility,
    Geo,
    OpeningHours,
    OpenPeriod,
    ResourceRecord,
    ResourceStatus,
    ResourceType,
)
from vrn.retrieval.filter import filter_resources

KIOSK = Geo(lat=43.6532, lng=-79.3832)
NOW = dt.datetime(2026, 5, 29, 22, 0, tzinfo=dt.timezone.utc)  # Friday night


def _record(rid, rtype, lat, lng, family_ok=True, verified_days_ago=1, overnight=True):
    hours = OpeningHours(
        periods=[OpenPeriod(weekday=4, open="20:00", close="08:00")] if overnight else [],
        always_open=not overnight,
    )
    return ResourceRecord(
        id=rid, name=rid, type=rtype, geo=Geo(lat=lat, lng=lng), address="x",
        hours=hours, eligibility=Eligibility(family_ok=family_ok), source="211",
        last_verified=NOW - dt.timedelta(days=verified_days_ago), status=ResourceStatus.OPEN,
    )


@pytest.mark.unit
def test_filters_by_type_and_sorts_by_distance():
    records = [
        _record("far", ResourceType.SHELTER, 43.70, -79.45),
        _record("near", ResourceType.SHELTER, 43.654, -79.384),
        _record("food", ResourceType.FOOD, 43.653, -79.383),
    ]
    q = ResourceQuery(type=ResourceType.SHELTER, open_now=True)
    matches = filter_resources(records, q, KIOSK, NOW, stale_after_days=14)
    assert [m.record.id for m in matches] == ["near", "far"]


@pytest.mark.unit
def test_open_now_excludes_closed():
    closed = _record("closed", ResourceType.SHELTER, 43.654, -79.384, overnight=False)
    closed.hours = OpeningHours(periods=[OpenPeriod(weekday=0, open="09:00", close="10:00")])
    matches = filter_resources([closed], ResourceQuery(open_now=True), KIOSK, NOW, 14)
    assert matches == []


@pytest.mark.unit
def test_family_requirement_and_distance_cap_and_staleness():
    records = [
        _record("nofam", ResourceType.SHELTER, 43.654, -79.384, family_ok=False),
        _record("stale", ResourceType.SHELTER, 43.654, -79.384, verified_days_ago=30),
    ]
    q = ResourceQuery(require_family_ok=True, max_distance_km=5.0)
    matches = filter_resources(records + [_record("ok", ResourceType.SHELTER, 43.654, -79.384, verified_days_ago=30)], q, KIOSK, NOW, 14)
    ids = [m.record.id for m in matches]
    assert "nofam" not in ids
    assert all(m.stale for m in matches if m.record.id == "ok")
```

- [ ] **Step 3: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_filter.py -v`
Expected: FAIL — `ModuleNotFoundError: vrn.retrieval.filter`.

- [ ] **Step 4: Write `src/vrn/retrieval/__init__.py` and `src/vrn/retrieval/filter.py`**

```python
# src/vrn/retrieval/__init__.py
__all__: list[str] = []
```

```python
# src/vrn/retrieval/filter.py
import datetime as dt

from vrn.geo import haversine_km
from vrn.hours import is_open_at
from vrn.models.conversation import ResourceMatch, ResourceQuery
from vrn.models.resource import Geo, ResourceRecord


def _eligible(record: ResourceRecord, query: ResourceQuery) -> bool:
    if query.type is not None and record.type is not query.type:
        return False
    if query.require_family_ok and not record.eligibility.family_ok:
        return False
    if query.gender and record.eligibility.gender and record.eligibility.gender != query.gender:
        return False
    return True


def filter_resources(
    records: list[ResourceRecord],
    query: ResourceQuery,
    kiosk: Geo,
    now: dt.datetime,
    stale_after_days: int,
) -> list[ResourceMatch]:
    matches: list[ResourceMatch] = []
    for record in records:
        if not _eligible(record, query):
            continue
        if query.open_now and not is_open_at(record.hours, now):
            continue
        distance = haversine_km(kiosk, record.geo)
        if query.max_distance_km is not None and distance > query.max_distance_km:
            continue
        stale = (now - record.last_verified) > dt.timedelta(days=stale_after_days)
        matches.append(ResourceMatch(record=record, distance_km=distance, stale=stale))
    matches.sort(key=lambda m: m.distance_km)
    return matches
```

- [ ] **Step 5: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_filter.py -v`
Expected: PASS.

- [ ] **Step 6: Checkpoint**

Run: `uv run ruff check src tests && uv run pytest -q`
Expected: ruff clean; all tests pass.

---

## Task 6: Resource repository (protocol + in-memory + Postgres adapter)

**Files:**
- Create: `src/vrn/retrieval/repository.py`
- Test: `tests/unit/test_repository.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_repository.py
import datetime as dt

import pytest

from vrn.models.resource import (
    Eligibility, Geo, OpeningHours, ResourceRecord, ResourceStatus, ResourceType,
)
from vrn.retrieval.repository import InMemoryResourceRepository


def _rec(rid, status):
    return ResourceRecord(
        id=rid, name=rid, type=ResourceType.SHELTER, geo=Geo(lat=43.6, lng=-79.3),
        address="x", hours=OpeningHours(always_open=True), eligibility=Eligibility(),
        source="211", last_verified=dt.datetime(2026, 5, 1, tzinfo=dt.timezone.utc),
        status=status,
    )


@pytest.mark.unit
def test_in_memory_repo_lists_only_non_closed():
    repo = InMemoryResourceRepository(
        [_rec("a", ResourceStatus.OPEN), _rec("b", ResourceStatus.CLOSED),
         _rec("c", ResourceStatus.UNKNOWN)]
    )
    ids = {r.id for r in repo.list_active()}
    assert ids == {"a", "c"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_repository.py -v`
Expected: FAIL — `ModuleNotFoundError: vrn.retrieval.repository`.

- [ ] **Step 3: Write `src/vrn/retrieval/repository.py`**

```python
from typing import Protocol

import psycopg

from vrn.models.resource import ResourceRecord, ResourceStatus


class ResourceRepository(Protocol):
    def list_active(self) -> list[ResourceRecord]:
        """Return all non-closed resources for in-process structured filtering."""
        ...


class InMemoryResourceRepository:
    def __init__(self, records: list[ResourceRecord]) -> None:
        self._records = records

    def list_active(self) -> list[ResourceRecord]:
        return [r for r in self._records if r.status is not ResourceStatus.CLOSED]


class PostgresResourceRepository:
    """Reads the verified directory. Each row stores the record as JSONB in `payload`."""

    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    def list_active(self) -> list[ResourceRecord]:
        with psycopg.connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute("SELECT payload FROM resources WHERE status <> 'closed'")
            return [ResourceRecord.model_validate(row[0]) for row in cur.fetchall()]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_repository.py -v`
Expected: PASS. (The Postgres adapter is exercised in Plan 3 against a live DB; unit tests use the in-memory repo.)

- [ ] **Step 5: Checkpoint**

Run: `uv run ruff check src tests && uv run pytest -q`
Expected: ruff clean; all tests pass.

---

## Task 7: Deterministic crisis gate (high recall)

**Files:**
- Create: `src/vrn/safety/__init__.py`, `src/vrn/safety/crisis_gate.py`
- Test: `tests/unit/test_crisis_gate.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_crisis_gate.py
import pytest

from vrn.safety.crisis_gate import detect_crisis


@pytest.mark.unit
@pytest.mark.parametrize(
    "text,category",
    [
        ("I want to kill myself", "self_harm"),
        ("I don't want to live anymore", "self_harm"),
        ("I think I overdosed on something", "medical_emergency"),
        ("my chest hurts and I can't breathe", "medical_emergency"),
        ("he is going to hurt me, I'm not safe", "violence"),
    ],
)
def test_detects_crisis_categories(text, category):
    result = detect_crisis(text)
    assert result.is_crisis is True
    assert result.category == category


@pytest.mark.unit
def test_normal_request_is_not_crisis():
    result = detect_crisis("I need a warm place to sleep tonight")
    assert result.is_crisis is False
    assert result.category is None


@pytest.mark.unit
def test_matching_is_case_insensitive():
    assert detect_crisis("I WANT TO DIE").is_crisis is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_crisis_gate.py -v`
Expected: FAIL — `ModuleNotFoundError: vrn.safety.crisis_gate`.

- [ ] **Step 3: Write `src/vrn/safety/__init__.py` and `src/vrn/safety/crisis_gate.py`**

```python
# src/vrn/safety/__init__.py
__all__: list[str] = []
```

```python
# src/vrn/safety/crisis_gate.py
import re

from vrn.models.conversation import CrisisResult

# Ordered by priority. Patterns favor RECALL: broad phrasing is intentional.
# A false positive routes to a human (safe); a false negative is the worst failure.
_PATTERNS: list[tuple[str, list[str]]] = [
    (
        "self_harm",
        [
            r"kill myself", r"want to die", r"don'?t want to live", r"end my life",
            r"hurt myself", r"suicid", r"no reason to live", r"can'?t go on",
        ],
    ),
    (
        "medical_emergency",
        [
            r"overdos", r"can'?t breathe", r"chest (hurts|pain)", r"bleeding",
            r"unconscious", r"seizure", r"heart attack",
        ],
    ),
    (
        "violence",
        [
            r"going to hurt me", r"not safe", r"being (attacked|assaulted)",
            r"he('?s| is) going to", r"threatened",
        ],
    ),
]

_COMPILED: list[tuple[str, list[re.Pattern[str]]]] = [
    (category, [re.compile(p, re.IGNORECASE) for p in patterns])
    for category, patterns in _PATTERNS
]


def detect_crisis(text: str) -> CrisisResult:
    for category, patterns in _COMPILED:
        matched = [p.pattern for p in patterns if p.search(text)]
        if matched:
            return CrisisResult(is_crisis=True, category=category, matched=matched)
    return CrisisResult(is_crisis=False)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_crisis_gate.py -v`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `uv run ruff check src tests && uv run pytest -q`
Expected: ruff clean; all tests pass.

---

## Task 8: Escalation reply builder

**Files:**
- Create: `src/vrn/safety/escalation.py`
- Test: `tests/unit/test_escalation.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_escalation.py
import pytest

from vrn.models.conversation import CrisisResult
from vrn.safety.escalation import build_escalation_reply


@pytest.mark.unit
def test_self_harm_escalation_includes_hotline_and_flags():
    reply = build_escalation_reply(CrisisResult(is_crisis=True, category="self_harm"))
    assert reply.is_crisis is True
    assert reply.escalated is True
    assert "988" in reply.message  # Canada Suicide Crisis Helpline


@pytest.mark.unit
def test_medical_emergency_directs_to_911():
    reply = build_escalation_reply(CrisisResult(is_crisis=True, category="medical_emergency"))
    assert "911" in reply.message


@pytest.mark.unit
def test_unknown_category_uses_general_211():
    reply = build_escalation_reply(CrisisResult(is_crisis=True, category=None))
    assert "211" in reply.message
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_escalation.py -v`
Expected: FAIL — `ModuleNotFoundError: vrn.safety.escalation`.

- [ ] **Step 3: Write `src/vrn/safety/escalation.py`**

```python
from vrn.models.conversation import CrisisResult, Reply

_MESSAGES: dict[str, str] = {
    "self_harm": (
        "It sounds like you're going through something really hard, and you deserve "
        "support right now. Please call or text 988, the Suicide Crisis Helpline — "
        "it's free and open 24/7. If you're in immediate danger, call 911. "
        "A staff member here can also stay with you."
    ),
    "medical_emergency": (
        "This may be a medical emergency. Please call 911 right now, or let a staff "
        "member here help you call. You don't have to handle this alone."
    ),
    "violence": (
        "Your safety matters. If you're in danger, call 911. You can also reach a "
        "staff member here, or call 211 to be connected to a safe place."
    ),
}

_GENERAL = (
    "I want to make sure you get the right help. Please call 211 to be connected with "
    "someone who can support you, or talk to a staff member here. If this is an "
    "emergency, call 911."
)


def build_escalation_reply(result: CrisisResult) -> Reply:
    message = _MESSAGES.get(result.category or "", _GENERAL)
    return Reply(message=message, is_crisis=True, escalated=True)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_escalation.py -v`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `uv run ruff check src tests && uv run pytest -q`
Expected: ruff clean; all tests pass.

---

## Task 9: ASR client interface + Parakeet NIM client

**Files:**
- Create: `src/vrn/asr/__init__.py`, `src/vrn/asr/base.py`, `src/vrn/asr/parakeet_nim.py`
- Test: `tests/unit/test_parakeet_nim.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_parakeet_nim.py
import httpx
import pytest

from vrn.asr.parakeet_nim import ParakeetNimClient


@pytest.mark.unit
def test_transcribe_parses_nim_response():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/audio/transcriptions"
        return httpx.Response(200, json={"text": "i need a shelter", "language": "en"})

    transport = httpx.MockTransport(handler)
    client = ParakeetNimClient("http://nim:9000", transport=transport)
    result = client.transcribe(b"RIFF....", filename="clip.wav")
    assert result.text == "i need a shelter"
    assert result.language == "en"


@pytest.mark.unit
def test_transcribe_empty_text_yields_low_confidence():
    transport = httpx.MockTransport(lambda r: httpx.Response(200, json={"text": "   "}))
    client = ParakeetNimClient("http://nim:9000", transport=transport)
    result = client.transcribe(b"", filename="clip.wav")
    assert result.text == ""
    assert result.confidence == 0.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_parakeet_nim.py -v`
Expected: FAIL — `ModuleNotFoundError: vrn.asr.parakeet_nim`.

- [ ] **Step 3: Write the asr package files**

```python
# src/vrn/asr/__init__.py
__all__: list[str] = []
```

```python
# src/vrn/asr/base.py
from typing import Protocol

from vrn.models.conversation import TranscriptionResult


class ASRClient(Protocol):
    def transcribe(self, audio: bytes, filename: str = "audio.wav") -> TranscriptionResult:
        ...
```

```python
# src/vrn/asr/parakeet_nim.py
import httpx

from vrn.models.conversation import TranscriptionResult


class ParakeetNimClient:
    """Swappable ASR client for the Parakeet TDT v3 NVIDIA Speech NIM."""

    def __init__(
        self, base_url: str, transport: httpx.BaseTransport | None = None, timeout: float = 30.0
    ) -> None:
        self._client = httpx.Client(base_url=base_url, transport=transport, timeout=timeout)

    def transcribe(self, audio: bytes, filename: str = "audio.wav") -> TranscriptionResult:
        response = self._client.post(
            "/v1/audio/transcriptions", files={"file": (filename, audio, "audio/wav")}
        )
        response.raise_for_status()
        body = response.json()
        text = (body.get("text") or "").strip()
        return TranscriptionResult(
            text=text,
            confidence=0.0 if not text else float(body.get("confidence", 1.0)),
            language=body.get("language", "en"),
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_parakeet_nim.py -v`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `uv run ruff check src tests && uv run pytest -q`
Expected: ruff clean; all tests pass.

---

## Task 10: LLM client (OpenAI-compatible NIM) + prompts

**Files:**
- Create: `src/vrn/llm/__init__.py`, `src/vrn/llm/base.py`, `src/vrn/llm/nim_client.py`, `src/vrn/llm/prompts.py`
- Test: `tests/unit/test_nim_client.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_nim_client.py
import httpx
import pytest

from vrn.llm.nim_client import NimLLMClient


@pytest.mark.unit
def test_chat_returns_tool_call_when_present():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "choices": [{"message": {
                "content": None,
                "tool_calls": [{
                    "id": "c1",
                    "function": {"name": "find_resources",
                                 "arguments": '{"type": "shelter", "open_now": true}'},
                }],
            }}]
        })

    client = NimLLMClient("http://nim:8000/v1", "gemma", transport=httpx.MockTransport(handler))
    resp = client.chat([{"role": "user", "content": "shelter please"}], tools=[{"x": 1}])
    assert resp.tool_calls[0].name == "find_resources"
    assert resp.tool_calls[0].arguments == {"type": "shelter", "open_now": True}
    assert resp.content is None


@pytest.mark.unit
def test_chat_returns_text_content():
    handler = lambda r: httpx.Response(200, json={  # noqa: E731
        "choices": [{"message": {"content": "Here is a shelter near you."}}]
    })
    client = NimLLMClient("http://nim:8000/v1", "gemma", transport=httpx.MockTransport(handler))
    resp = client.chat([{"role": "user", "content": "hi"}])
    assert resp.content == "Here is a shelter near you."
    assert resp.tool_calls == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_nim_client.py -v`
Expected: FAIL — `ModuleNotFoundError: vrn.llm.nim_client`.

- [ ] **Step 3: Write the llm package files**

```python
# src/vrn/llm/__init__.py
__all__: list[str] = []
```

```python
# src/vrn/llm/base.py
import json
from typing import Any, Protocol

from pydantic import BaseModel, Field


class ToolCall(BaseModel):
    id: str
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class LLMResponse(BaseModel):
    content: str | None = None
    tool_calls: list[ToolCall] = Field(default_factory=list)


def parse_tool_calls(raw_calls: list[dict[str, Any]]) -> list[ToolCall]:
    parsed: list[ToolCall] = []
    for call in raw_calls:
        fn = call.get("function", {})
        args_raw = fn.get("arguments") or "{}"
        arguments = json.loads(args_raw) if isinstance(args_raw, str) else args_raw
        parsed.append(ToolCall(id=call.get("id", ""), name=fn.get("name", ""), arguments=arguments))
    return parsed


class LLMClient(Protocol):
    def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
    ) -> LLMResponse:
        ...
```

```python
# src/vrn/llm/nim_client.py
from typing import Any

import httpx

from vrn.llm.base import LLMResponse, parse_tool_calls


class NimLLMClient:
    """OpenAI-compatible client for a self-hosted Gemma NIM."""

    def __init__(
        self,
        base_url: str,
        model: str,
        transport: httpx.BaseTransport | None = None,
        timeout: float = 60.0,
    ) -> None:
        self._client = httpx.Client(base_url=base_url, transport=transport, timeout=timeout)
        self._model = model

    def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
    ) -> LLMResponse:
        payload: dict[str, Any] = {"model": self._model, "messages": messages, "temperature": 0.2}
        if tools:
            payload["tools"] = tools
        response = self._client.post("/chat/completions", json=payload)
        response.raise_for_status()
        message = response.json()["choices"][0]["message"]
        return LLMResponse(
            content=message.get("content"),
            tool_calls=parse_tool_calls(message.get("tool_calls") or []),
        )
```

```python
# src/vrn/llm/prompts.py
SYSTEM_PROMPT = (
    "You are a calm, kind assistant at a kiosk that helps people find nearby shelters, "
    "food banks, and hospitals. You speak simply and without judgment.\n\n"
    "RULES:\n"
    "1. To find places, you MUST call the find_resources tool. Never invent a place, "
    "address, phone number, or hours from your own knowledge.\n"
    "2. Only describe resources that the tool returned. Refer to each by its exact id.\n"
    "3. If the tool returns nothing, tell the person you couldn't find a match right now "
    "and suggest they call 211 or ask a staff member.\n"
    "4. Keep replies short, warm, and concrete: name, address, and hours.\n"
)

FIND_RESOURCES_TOOL = {
    "type": "function",
    "function": {
        "name": "find_resources",
        "description": "Find verified nearby resources matching the person's need.",
        "parameters": {
            "type": "object",
            "properties": {
                "type": {"type": "string",
                         "enum": ["shelter", "food", "hospital", "clinic", "dropin"]},
                "open_now": {"type": "boolean"},
                "require_family_ok": {"type": "boolean"},
                "gender": {"type": "string"},
                "max_distance_km": {"type": "number"},
            },
        },
    },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_nim_client.py -v`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `uv run ruff check src tests && uv run pytest -q`
Expected: ruff clean; all tests pass.

---

## Task 11: `find_resources` tool

**Files:**
- Create: `src/vrn/agent/__init__.py`, `src/vrn/agent/tools.py`
- Test: `tests/unit/test_tools.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_tools.py
import datetime as dt

import pytest

from vrn.agent.tools import ResourceFinder
from vrn.models.resource import (
    Eligibility, Geo, OpeningHours, ResourceRecord, ResourceStatus, ResourceType,
)
from vrn.retrieval.repository import InMemoryResourceRepository

KIOSK = Geo(lat=43.6532, lng=-79.3832)
NOW = dt.datetime(2026, 5, 29, 22, 0, tzinfo=dt.timezone.utc)


def _rec(rid):
    return ResourceRecord(
        id=rid, name=rid, type=ResourceType.SHELTER, geo=Geo(lat=43.654, lng=-79.384),
        address="x", hours=OpeningHours(always_open=True), eligibility=Eligibility(),
        source="211", last_verified=NOW - dt.timedelta(days=1), status=ResourceStatus.OPEN,
    )


@pytest.mark.unit
def test_finder_applies_defaults_and_returns_matches():
    finder = ResourceFinder(
        repository=InMemoryResourceRepository([_rec("near")]),
        kiosk=KIOSK, clock=lambda: NOW, default_max_distance_km=10.0, stale_after_days=14,
    )
    matches = finder.find({"type": "shelter", "open_now": True})
    assert [m.record.id for m in matches] == ["near"]


@pytest.mark.unit
def test_finder_caps_distance_by_default_when_not_supplied():
    finder = ResourceFinder(
        repository=InMemoryResourceRepository([_rec("near")]),
        kiosk=KIOSK, clock=lambda: NOW, default_max_distance_km=0.001, stale_after_days=14,
    )
    assert finder.find({"type": "shelter"}) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_tools.py -v`
Expected: FAIL — `ModuleNotFoundError: vrn.agent.tools`.

- [ ] **Step 3: Write `src/vrn/agent/__init__.py` and `src/vrn/agent/tools.py`**

```python
# src/vrn/agent/__init__.py
__all__: list[str] = []
```

```python
# src/vrn/agent/tools.py
import datetime as dt
from collections.abc import Callable
from typing import Any

from vrn.models.conversation import ResourceMatch, ResourceQuery
from vrn.models.resource import Geo
from vrn.retrieval.filter import filter_resources
from vrn.retrieval.repository import ResourceRepository


class ResourceFinder:
    """Executes the find_resources tool: structured filter over the verified directory."""

    def __init__(
        self,
        repository: ResourceRepository,
        kiosk: Geo,
        clock: Callable[[], dt.datetime],
        default_max_distance_km: float,
        stale_after_days: int,
    ) -> None:
        self._repository = repository
        self._kiosk = kiosk
        self._clock = clock
        self._default_max_distance_km = default_max_distance_km
        self._stale_after_days = stale_after_days

    def find(self, arguments: dict[str, Any]) -> list[ResourceMatch]:
        query = ResourceQuery.model_validate(arguments)
        if query.max_distance_km is None:
            query = query.model_copy(update={"max_distance_km": self._default_max_distance_km})
        return filter_resources(
            self._repository.list_active(),
            query,
            self._kiosk,
            self._clock(),
            self._stale_after_days,
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_tools.py -v`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `uv run ruff check src tests && uv run pytest -q`
Expected: ruff clean; all tests pass.

---

## Task 12: Hybrid orchestrator with grounding enforcement

**Files:**
- Create: `src/vrn/agent/orchestrator.py`
- Test: `tests/unit/test_orchestrator.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_orchestrator.py
import datetime as dt

import pytest

from vrn.agent.orchestrator import Orchestrator
from vrn.agent.tools import ResourceFinder
from vrn.llm.base import LLMResponse, ToolCall
from vrn.models.conversation import TranscriptionResult
from vrn.models.resource import (
    Eligibility, Geo, OpeningHours, ResourceRecord, ResourceStatus, ResourceType,
)
from vrn.retrieval.repository import InMemoryResourceRepository

KIOSK = Geo(lat=43.6532, lng=-79.3832)
NOW = dt.datetime(2026, 5, 29, 22, 0, tzinfo=dt.timezone.utc)


def _rec(rid):
    return ResourceRecord(
        id=rid, name=rid, type=ResourceType.SHELTER, geo=Geo(lat=43.654, lng=-79.384),
        address="1 Main St", hours=OpeningHours(always_open=True), eligibility=Eligibility(),
        source="211", last_verified=NOW - dt.timedelta(days=1), status=ResourceStatus.OPEN,
    )


class StubASR:
    def __init__(self, text):
        self._text = text

    def transcribe(self, audio, filename="audio.wav"):
        return TranscriptionResult(text=self._text)


class ScriptedLLM:
    """Returns queued responses in order."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def chat(self, messages, tools=None):
        self.calls.append(messages)
        return self._responses.pop(0)


def _finder(records):
    return ResourceFinder(InMemoryResourceRepository(records), KIOSK, lambda: NOW, 10.0, 14)


@pytest.mark.unit
def test_crisis_short_circuits_before_llm():
    llm = ScriptedLLM([])  # must never be called
    orch = Orchestrator(StubASR("I want to kill myself"), llm, _finder([_rec("a")]))
    reply = orch.handle_audio(b"x")
    assert reply.is_crisis is True
    assert reply.escalated is True
    assert llm.calls == []


@pytest.mark.unit
def test_happy_path_calls_tool_then_composes_grounded_reply():
    llm = ScriptedLLM([
        LLMResponse(tool_calls=[ToolCall(id="c1", name="find_resources",
                                         arguments={"type": "shelter", "open_now": True})]),
        LLMResponse(content="You can go to a (id: a) at 1 Main St."),
    ])
    orch = Orchestrator(StubASR("I need a shelter"), llm, _finder([_rec("a")]))
    reply = orch.handle_audio(b"x")
    assert reply.is_crisis is False
    assert [m.record.id for m in reply.matches] == ["a"]
    assert "1 Main St" in reply.message


@pytest.mark.unit
def test_no_matches_returns_safe_fallback():
    llm = ScriptedLLM([
        LLMResponse(tool_calls=[ToolCall(id="c1", name="find_resources",
                                         arguments={"type": "shelter"})]),
    ])
    orch = Orchestrator(StubASR("I need a shelter"), llm, _finder([]))
    reply = orch.handle_audio(b"x")
    assert reply.fallback is True
    assert "211" in reply.message


@pytest.mark.unit
def test_empty_transcript_asks_to_repeat():
    orch = Orchestrator(StubASR("   "), ScriptedLLM([]), _finder([_rec("a")]))
    reply = orch.handle_audio(b"x")
    assert reply.fallback is True
    assert "didn't catch" in reply.message.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_orchestrator.py -v`
Expected: FAIL — `ModuleNotFoundError: vrn.agent.orchestrator`.

- [ ] **Step 3: Write `src/vrn/agent/orchestrator.py`**

```python
from vrn.agent.tools import ResourceFinder
from vrn.asr.base import ASRClient
from vrn.llm.base import LLMClient
from vrn.llm.prompts import FIND_RESOURCES_TOOL, SYSTEM_PROMPT
from vrn.models.conversation import Reply
from vrn.safety.crisis_gate import detect_crisis
from vrn.safety.escalation import build_escalation_reply

_FALLBACK = (
    "I couldn't find a match right now. Please call 211 to be connected with someone "
    "who can help, or ask a staff member here."
)
_REPEAT = "Sorry, I didn't catch that. Could you say it again?"


class Orchestrator:
    """Hybrid control: deterministic crisis gate, then a bounded one-tool agent."""

    def __init__(self, asr: ASRClient, llm: LLMClient, finder: ResourceFinder) -> None:
        self._asr = asr
        self._llm = llm
        self._finder = finder

    def handle_audio(self, audio: bytes, filename: str = "audio.wav") -> Reply:
        transcript = self._asr.transcribe(audio, filename=filename)
        if not transcript.text:
            return Reply(message=_REPEAT, fallback=True)

        crisis = detect_crisis(transcript.text)
        if crisis.is_crisis:
            return build_escalation_reply(crisis)

        return self._run_agent(transcript.text)

    def _run_agent(self, text: str) -> Reply:
        messages: list[dict] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ]
        first = self._llm.chat(messages, tools=[FIND_RESOURCES_TOOL])
        if not first.tool_calls:
            # Model answered without searching; never allow ungrounded resource answers.
            return Reply(message=_FALLBACK, fallback=True)

        call = first.tool_calls[0]
        matches = self._finder.find(call.arguments)
        if not matches:
            return Reply(message=_FALLBACK, fallback=True)

        tool_payload = [
            {"id": m.record.id, "name": m.record.name, "address": m.record.address,
             "phone": m.record.phone, "distance_km": round(m.distance_km, 2), "stale": m.stale}
            for m in matches
        ]
        messages.append({"role": "assistant", "content": None,
                         "tool_calls": [{"id": call.id,
                                         "function": {"name": call.name, "arguments": "{}"}}]})
        messages.append({"role": "tool", "tool_call_id": call.id, "content": str(tool_payload)})
        final = self._llm.chat(messages)
        message = final.content or _FALLBACK
        return Reply(message=message, matches=matches, fallback=final.content is None)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_orchestrator.py -v`
Expected: PASS (all four cases).

- [ ] **Step 5: Checkpoint**

Run: `uv run ruff check src tests && uv run pytest -q`
Expected: ruff clean; all tests pass.

---

## Task 13: Grounding-citation guard

**Files:**
- Modify: `src/vrn/agent/orchestrator.py` (add citation check to `_run_agent`)
- Test: `tests/unit/test_orchestrator.py` (add a case)

- [ ] **Step 1: Add the failing test**

```python
# append to tests/unit/test_orchestrator.py
@pytest.mark.unit
def test_reply_citing_unknown_resource_is_rejected():
    llm = ScriptedLLM([
        LLMResponse(tool_calls=[ToolCall(id="c1", name="find_resources",
                                         arguments={"type": "shelter"})]),
        LLMResponse(content="Go to the Imaginary Shelter at 999 Fake Rd."),  # cites nothing real
    ])
    orch = Orchestrator(StubASR("I need a shelter"), llm, _finder([_rec("a")]))
    reply = orch.handle_audio(b"x")
    assert reply.fallback is True
    assert "211" in reply.message
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_orchestrator.py::test_reply_citing_unknown_resource_is_rejected -v`
Expected: FAIL — current code returns the ungrounded message.

- [ ] **Step 3: Add the guard in `_run_agent`**

Replace the final three lines of `_run_agent` (from `final = self._llm.chat(messages)` onward) with:

```python
        final = self._llm.chat(messages)
        if not final.content or not self._is_grounded(final.content, matches):
            return Reply(message=_FALLBACK, matches=matches, fallback=True)
        return Reply(message=final.content, matches=matches)

    @staticmethod
    def _is_grounded(message: str, matches) -> bool:
        # The reply must reference at least one real retrieved resource (by id or exact name).
        lowered = message.lower()
        for m in matches:
            if m.record.id.lower() in lowered or m.record.name.lower() in lowered:
                return True
        return False
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `uv run pytest tests/unit/test_orchestrator.py -v`
Expected: PASS — including the happy-path test (its reply contains `id: a`) and the new rejection test.

- [ ] **Step 5: Checkpoint**

Run: `uv run ruff check src tests && uv run pytest -q`
Expected: ruff clean; all tests pass.

---

## Task 14: FastAPI `/converse` endpoint (integration)

**Files:**
- Create: `src/vrn/api/__init__.py`, `src/vrn/api/app.py`
- Test: `tests/integration/__init__.py`, `tests/integration/test_converse_endpoint.py`

- [ ] **Step 1: Write the failing integration test**

```python
# tests/integration/test_converse_endpoint.py
import datetime as dt

import pytest
from fastapi.testclient import TestClient

from vrn.agent.orchestrator import Orchestrator
from vrn.agent.tools import ResourceFinder
from vrn.api.app import create_app, get_orchestrator
from vrn.llm.base import LLMResponse, ToolCall
from vrn.models.conversation import TranscriptionResult
from vrn.models.resource import (
    Eligibility, Geo, OpeningHours, ResourceRecord, ResourceStatus, ResourceType,
)
from vrn.retrieval.repository import InMemoryResourceRepository

KIOSK = Geo(lat=43.6532, lng=-79.3832)
NOW = dt.datetime(2026, 5, 29, 22, 0, tzinfo=dt.timezone.utc)


class StubASR:
    def transcribe(self, audio, filename="audio.wav"):
        return TranscriptionResult(text="I need a shelter")


class ScriptedLLM:
    def __init__(self, responses):
        self._responses = list(responses)

    def chat(self, messages, tools=None):
        return self._responses.pop(0)


def _orch():
    rec = ResourceRecord(
        id="a", name="Downtown Shelter", type=ResourceType.SHELTER,
        geo=Geo(lat=43.654, lng=-79.384), address="1 Main St",
        hours=OpeningHours(always_open=True), eligibility=Eligibility(), source="211",
        last_verified=NOW - dt.timedelta(days=1), status=ResourceStatus.OPEN,
    )
    finder = ResourceFinder(InMemoryResourceRepository([rec]), KIOSK, lambda: NOW, 10.0, 14)
    llm = ScriptedLLM([
        LLMResponse(tool_calls=[ToolCall(id="c1", name="find_resources",
                                         arguments={"type": "shelter", "open_now": True})]),
        LLMResponse(content="You can go to Downtown Shelter at 1 Main St."),
    ])
    return Orchestrator(StubASR(), llm, finder)


@pytest.fixture
def client():
    app = create_app()
    app.dependency_overrides[get_orchestrator] = _orch
    return TestClient(app)


@pytest.mark.integration
def test_converse_returns_grounded_reply(client):
    resp = client.post("/converse", files={"audio": ("clip.wav", b"RIFF....", "audio/wav")})
    assert resp.status_code == 200
    body = resp.json()
    assert body["is_crisis"] is False
    assert body["matches"][0]["record"]["id"] == "a"
    assert "Downtown Shelter" in body["message"]


@pytest.mark.integration
def test_converse_rejects_empty_upload(client):
    resp = client.post("/converse", files={"audio": ("clip.wav", b"", "audio/wav")})
    assert resp.status_code == 400
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/integration/test_converse_endpoint.py -v`
Expected: FAIL — `ModuleNotFoundError: vrn.api.app`. (Create empty `tests/integration/__init__.py`.)

- [ ] **Step 3: Write `src/vrn/api/__init__.py` and `src/vrn/api/app.py`**

```python
# src/vrn/api/__init__.py
__all__: list[str] = []
```

```python
# src/vrn/api/app.py
import datetime as dt

from fastapi import Depends, FastAPI, HTTPException, UploadFile

from vrn.agent.orchestrator import Orchestrator
from vrn.agent.tools import ResourceFinder
from vrn.asr.parakeet_nim import ParakeetNimClient
from vrn.config import get_settings
from vrn.llm.nim_client import NimLLMClient
from vrn.logging_config import configure_logging
from vrn.models.conversation import Reply
from vrn.models.resource import Geo
from vrn.retrieval.repository import PostgresResourceRepository


def get_orchestrator() -> Orchestrator:
    settings = get_settings()
    finder = ResourceFinder(
        repository=PostgresResourceRepository(settings.database_url),
        kiosk=Geo(lat=settings.kiosk_lat, lng=settings.kiosk_lng),
        clock=lambda: dt.datetime.now(dt.timezone.utc),
        default_max_distance_km=settings.max_distance_km,
        stale_after_days=settings.stale_after_days,
    )
    return Orchestrator(
        asr=ParakeetNimClient(settings.asr_nim_url),
        llm=NimLLMClient(settings.llm_nim_url, settings.llm_model),
        finder=finder,
    )


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.service_name, settings.log_level)
    app = FastAPI(title="Voice Resource Navigator")

    @app.post("/converse", response_model=Reply)
    async def converse(
        audio: UploadFile, orchestrator: Orchestrator = Depends(get_orchestrator)
    ) -> Reply:
        data = await audio.read()
        if not data:
            raise HTTPException(status_code=400, detail="Empty audio upload")
        return orchestrator.handle_audio(data, filename=audio.filename or "audio.wav")

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/integration/test_converse_endpoint.py -v`
Expected: PASS (both cases).

- [ ] **Step 5: Checkpoint**

Run: `uv run ruff check src tests && uv run pytest -q`
Expected: ruff clean; full suite passes. Then verify coverage of changed files is ≥60% per Bell standard:
Run: `uv run pytest -q --cov=vrn --cov-report=term-missing` (add `pytest-cov` to dev deps if measuring).

---

## Task 15: NeMo Agent toolkit registration + eval scaffold

**Files:**
- Create: `nemo/workflow.yaml`, `src/vrn/nemo_integration.py`
- Note: This task wires the existing `ResourceFinder` and orchestrator into NeMo Agent toolkit for observability/profiling and the eval harness (Plan 5). It does not change runtime behavior. No TDD step (configuration + thin registration); validated by `nat` CLI in Plan 3/5.

- [ ] **Step 1: Write `nemo/workflow.yaml`**

```yaml
# Pins the toolkit version per spec §12 item 2. Uses a self-hosted NIM (no cloud key).
general:
  use_uvloop: true

llms:
  gemma:
    _type: nim
    base_url: ${VRN_LLM_NIM_URL}
    model_name: ${VRN_LLM_MODEL}
    temperature: 0.2

functions:
  find_resources:
    _type: vrn_find_resources   # registered in src/vrn/nemo_integration.py

workflow:
  _type: tool_calling_agent
  llm_name: gemma
  tool_names: [find_resources]
  system_prompt_file: nemo/system_prompt.txt
```

- [ ] **Step 2: Write `src/vrn/nemo_integration.py`**

```python
"""Registers the find_resources tool with NeMo Agent toolkit for observability + eval.

The deterministic crisis gate stays in vrn.agent.orchestrator and is intentionally NOT
delegated to the agent. NeMo wraps only the bounded resource agent.
"""
import datetime as dt
from typing import Any

from vrn.agent.tools import ResourceFinder
from vrn.config import get_settings
from vrn.models.resource import Geo
from vrn.retrieval.repository import PostgresResourceRepository


def build_finder() -> ResourceFinder:
    settings = get_settings()
    return ResourceFinder(
        repository=PostgresResourceRepository(settings.database_url),
        kiosk=Geo(lat=settings.kiosk_lat, lng=settings.kiosk_lng),
        clock=lambda: dt.datetime.now(dt.timezone.utc),
        default_max_distance_km=settings.max_distance_km,
        stale_after_days=settings.stale_after_days,
    )


def find_resources_entrypoint(arguments: dict[str, Any]) -> list[dict[str, Any]]:
    matches = build_finder().find(arguments)
    return [
        {"id": m.record.id, "name": m.record.name, "address": m.record.address,
         "phone": m.record.phone, "distance_km": round(m.distance_km, 2), "stale": m.stale}
        for m in matches
    ]
```

- [ ] **Step 3: Document the version pin**

Add to `pyproject.toml` dependencies (commented until Plan 3 deployment validates the version):
```toml
# "nvidia-nat>=1.3,<1.8",  # NeMo Agent toolkit; pin exact version during Plan 3 infra work
```

- [ ] **Step 4: Checkpoint**

Run: `uv run ruff check src tests && uv run pytest -q`
Expected: ruff clean; full suite still passes (no behavioral change).

---

## Self-Review

**1. Spec coverage**

| Spec section | Covered by |
|---|---|
| §4 Path-A architecture | Tasks 9–14 (ASR → gate → retrieval → LLM → API) |
| §5.1 Audio capture | Task 14 endpoint accepts the recorded upload (button UI is Plan 4) |
| §5.2 ASR (Parakeet, swappable) | Tasks 9, 14 (`ASRClient` protocol + Parakeet NIM client) |
| §5.3 Hybrid orchestrator (gate + bounded agent) | Tasks 12–13 |
| §5.4 Structured-first retrieval | Tasks 3–6, 11 (geo, hours, filter, repo, finder); vector tiers deferred to Plans 2/5 |
| §5.6 LLM (Gemma, self-hosted NIM, grounding) | Tasks 10, 12–13 |
| §5.7 Safety/grounding | Tasks 7, 8, 13 |
| §6 Resource schema | Task 2 |
| §7 Data flow | Task 12 orchestrator sequence |
| §8 Error/edge handling | Task 12 (empty/no-match/crisis), Task 13 (ungrounded), Task 14 (empty upload) |
| §9 Privacy | Task 1 JSON logging with no PII fields; audio not persisted (handled in memory only) |
| §10 Testing | unit markers throughout; integration in Task 14; load/eval are Plans 5 |
| §13 Stack/conventions | Task 1 (uv + Artifactory, ruff, pytest markers, Pydantic, config module) |
| §11/§12 Roadmap/validation | Task 15 (NeMo pin), deferred items noted as Plans 2–5 |

Gaps are intentional and assigned to follow-on plans (data pipeline, infra/NIM deployment, kiosk UI, eval harness, vector retrieval tiers).

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Every code step shows full code. The single commented dependency (NeMo version) is intentional and explained.

**3. Type consistency:** `ResourceMatch`, `ResourceQuery`, `Reply`, `TranscriptionResult`, `CrisisResult` (Task 5/2) are reused consistently. `ResourceFinder.find(arguments: dict)` matches its call sites (Tasks 12, 15). `LLMResponse`/`ToolCall` (Task 10) match orchestrator usage (Task 12). `filter_resources(...)` signature is identical across Tasks 5, 11. `is_open_at`, `haversine_km`, `detect_crisis`, `build_escalation_reply` signatures match call sites.
