"""
config.py
All constants for Haven Matrix. No logic here — tune without touching other files.
"""

import os
from pathlib import Path
from enum import Enum


class EngineMode(Enum):
    GPU = "gpu"
    CPU = "cpu"


# ── Paths ─────────────────────────────────────────────────────────────────────
DATA_DIR       = Path("data")
LOG_DIR        = Path("logs")
SHELTERS_CSV    = DATA_DIR / "shelters.csv"
REHAB_CSV       = DATA_DIR / "rehab_services.csv"
FOOD_CSV        = DATA_DIR / "food_banks.csv"
HYGIENE_CSV     = DATA_DIR / "hygiene_stations.csv"
GRASSROOTS_CSV  = DATA_DIR / "grassroots_services.csv"
OSM_JSON        = DATA_DIR / "osm_amenities.json"
GTFS_STOPS_TXT  = DATA_DIR / "stops.txt"
# Upstream prevention pillars (demand shedding)
YOUTH_SPACES_CSV = DATA_DIR / "youth_spaces.csv"
LIBRARIES_CSV    = DATA_DIR / "libraries.csv"
RESPITE_CSV      = DATA_DIR / "respite_sites.csv"
# Telemetry shadow census
TELEMETRY_CSV    = DATA_DIR / "daily_telemetry.csv"

# ── LLM Endpoints ─────────────────────────────────────────────────────────────
# Tier 1 — NVIDIA cloud NIM (build.nvidia.com); requires NGC_API_KEY
NVIDIA_CLOUD_ENDPOINT = os.environ.get("NVIDIA_CLOUD_ENDPOINT", "https://integrate.api.nvidia.com/v1")
NVIDIA_CLOUD_MODEL    = os.environ.get("NVIDIA_CLOUD_MODEL",    "google/gemma-3n-e4b-it")

# Tier 2 — local llama.cpp (Nemotron-30B on GX10 :30000)
NIM_ENDPOINT    = os.environ.get("NIM_ENDPOINT",  "http://localhost:30000/v1")
NEMOTRON_MODEL  = "nemotron"

# Tier 3 — local NIM container (Gemma 3n E4B on GX10 :8001)
NIM_FALLBACK    = os.environ.get("NIM_FALLBACK",  "http://localhost:8001/v1")
NIM_MODEL       = "google/gemma-3n-e4b-it"

NIM_TIMEOUT_SEC = 15
NIM_MAX_RETRIES = 2

# When true, skip cuDF/cuML — reserve GPU for LLM only (Gemma NIM / llama.cpp)
FORCE_CPU_SOLVER = os.environ.get("FORCE_CPU_SOLVER", "0").lower() in ("1", "true", "yes")

# ── ASR NIM (Parakeet-0.6B-CTC) ───────────────────────────────────────────────
# Tier 1 — local NIM container on GX10 GPU (port 9000)
ASR_NIM_URL     = os.environ.get("ASR_NIM_URL",   "http://localhost:9000")
# Tier 2 — NVIDIA cloud ASR (requires NGC_API_KEY; audio leaves device)
ASR_CLOUD_URL   = os.environ.get("ASR_CLOUD_URL", "https://integrate.api.nvidia.com/v1")
# Tier 3 — Web Speech API fallback (handled in browser; backend raises 503)
ASR_NIM_TIMEOUT = 30   # seconds — audio transcription is slower than text

# ── Toronto CKAN ──────────────────────────────────────────────────────────────
SHELTER_CKAN_URL = (
    "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search"
    "?resource_id=42714176-4f05-44e6-b157-2b57f29b856a&limit=500"
)
CKAN_STARTUP_TIMEOUT  = 10    # seconds — initial load on startup
CKAN_HYDRATE_TIMEOUT  = 0.5   # seconds — background refresh (500ms fail-safe)

# ── Environment Canada Weather ─────────────────────────────────────────────────
WEATHER_FEED_URL = "https://weather.gc.ca/rss/warning/on-94_e.xml"  # Toronto region
WEATHER_TIMEOUT  = 0.5   # 500ms fail-safe for weather hydration

# ── Upstream Prevention Constants ─────────────────────────────────────────────
YOUTH_AGE_MIN = 13
YOUTH_AGE_MAX = 24

# ── Kiosk Hub Coordinates (Gateway B pre-configured locations) ─────────────────
KIOSK_HUBS = {
    "Union Station":      (43.6452, -79.3806),
    "Yonge & Dundas":     (43.6561, -79.3802),
    "Scarborough Centre": (43.7731, -79.2570),
    "Regent Park":        (43.6584, -79.3606),
    "Etobicoke Civic":    (43.6435, -79.5605),
}

# ── Voice Session Timeouts ────────────────────────────────────────────────────
VOICE_HOLD_MAX_SEC         = 45
VOICE_SILENCE_KILL_SEC     = 10
VOICE_SESSION_IDLE_SEC     = 120
VOICE_ELIGIBILITY_WAIT_SEC = 30
VOICE_MIN_TRANSCRIPT_CHARS = 10

# ── Eligibility question triggers ─────────────────────────────────────────────
ASK_ID_FOR_PILLARS       = ["shelter", "rehab"]
ASK_SOBRIETY_FOR_PILLARS = ["shelter"]
ASK_GROUP_FOR_PILLARS    = ["shelter"]

# ── Solver Weights (FR-5 Congestion Balancer) ─────────────────────────────────
WEIGHT_DISTANCE        = 0.60
WEIGHT_OCCUPANCY       = 0.30
WEIGHT_TRANSIT         = 0.10
TRANSIT_RADIUS_M       = 200
KNN_RESULTS_PER_PILLAR = 3

# ── NIM System Prompts ────────────────────────────────────────────────────────
NIM_TRIAGE_PROMPT = """You are a deterministic JSON compiler for a social services triage system.

Your ONLY job is to read input (caseworker notes or a person's spoken words) and output a
single valid JSON object. Output NOTHING else — no explanation, no markdown, no preamble.

PRIVACY RULE: Input may contain residual personal identifiers (names, addresses, health
conditions, medication names). Ignore all personal information completely. Focus ONLY on
the service needs described. Your JSON output must never contain names, contact details,
health diagnoses, or any other personal information.

JSON schema (all fields required):
{
  "needs_shelter":       <true|false>,
  "needs_rehab":         <true|false>,
  "needs_food":          <true|false>,
  "needs_supplies":      <true|false>,
  "needs_hygiene":       <true|false>,
  "needs_youth_service": <true|false>,
  "needs_library":       <true|false>,
  "needs_respite":       <true|false>,
  "sector":              <"youth"|"adult"|"family"|"any">,
  "has_id":              <true|false|null>,
  "sobriety_status":     <"sober"|"using"|null>,
  "group_size":          <"alone"|"with_family"|null>
}

Field rules:
- needs_shelter: true if person needs a bed, shelter, place to sleep, or housing
- needs_rehab: true if any mention of drugs, alcohol, detox, withdrawal, mental health crisis
- needs_food: true if person is hungry, needs food, a meal, food bank
- needs_supplies: true if person needs clothing, blankets, winter gear
- needs_hygiene: true if person needs a shower, laundry, washroom, or hygiene items
- needs_youth_service: true if person is a youth (13-24) needing safe indoor space, programs, computers
- needs_library: true if person needs internet access, computers, digital forms, daytime respite in a library
- needs_respite: true if person needs a warming centre, daytime low-barrier shelter, or just somewhere safe and warm
- sector: infer from age/demographic; default to "any"
- has_id: only set if explicitly mentioned; otherwise null
- sobriety_status: only set if explicitly mentioned; otherwise null
- group_size: only set if explicitly mentioned; otherwise null
"""

NIM_BRIEFING_PROMPT = """You are writing a shift briefing for a Toronto social services outreach team.
Summarize the data in 3-5 plain-English sentences. Focus on: which sectors have capacity,
which are nearly full, and any time-sensitive meal programs. Be direct and practical.
Do not use jargon. Output only the briefing text, no preamble."""

NIM_HANDOFF_PROMPT = """You are writing a phone script for a Toronto social services caseworker.
Write 4-6 sentences. State the client's needs clearly (no name). Ask the specific question
that determines admission eligibility for this facility. Include a follow-up ask if they
cannot help. Professional tone. Output only the script text, no preamble."""
