"""
data_ingestion.py
Zero-copy RAPIDS ingestion (GPU) with pandas fallback (CPU).
Run: python backend/data_ingestion.py --verify [--mode gpu|cpu]
"""

import logging
import time
import json
import argparse
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

# Allow running from repo root
sys.path.insert(0, str(Path(__file__).parent))

from config import (
    EngineMode, SHELTERS_CSV, REHAB_CSV, FOOD_CSV, HYGIENE_CSV,
    GRASSROOTS_CSV, OSM_JSON, GTFS_STOPS_TXT, SHELTER_CKAN_URL,
    YOUTH_SPACES_CSV, LIBRARIES_CSV, RESPITE_CSV,
    CKAN_STARTUP_TIMEOUT, CKAN_HYDRATE_TIMEOUT,
    WEATHER_FEED_URL, WEATHER_TIMEOUT,
)

_weather_alert: str | None = None


def load_all(mode: EngineMode = EngineMode.GPU) -> tuple[dict, float]:
    """Load all 7 datasets. Returns (datasets_dict, load_time_ms)."""
    if mode == EngineMode.GPU:
        import cudf as pd_engine
    else:
        import pandas as pd_engine

    t0 = time.perf_counter()
    datasets = {}

    # Shelter — live CKAN with local fallback
    shelters = _fetch_shelters_ckan(pd_engine)
    if shelters is None:
        shelters = pd_engine.read_csv(SHELTERS_CSV)
    shelters = _standardize_coords(shelters, lat_col="LAT", lon_col="LON")
    shelters["occupancy_ratio"] = (
        shelters["SERVICE_USER_COUNT"].astype("float32") /
        shelters["CAPACITY_ACTUAL_BED"].clip(lower=1).astype("float32")
    ).clip(upper=1.0)

    for col, default in [("requires_id", False), ("harm_reduction", True), ("accepts_walk_in", True)]:
        if col not in shelters.columns:
            shelters[col] = default
    datasets["shelters"] = shelters

    # All other tabular datasets (core + upstream prevention pillars)
    for key, path in [
        ("rehab",        REHAB_CSV),
        ("food",         FOOD_CSV),
        ("hygiene",      HYGIENE_CSV),
        ("grassroots",   GRASSROOTS_CSV),
        ("youth_spaces", YOUTH_SPACES_CSV),
        ("libraries",    LIBRARIES_CSV),
        ("respite",      RESPITE_CSV),
    ]:
        df = pd_engine.read_csv(path)
        df = _standardize_coords(df)
        for col, default in [("requires_id", False), ("harm_reduction", True)]:
            if col not in df.columns:
                df[col] = default
        if "bypass_pathway" not in df.columns:
            df["bypass_pathway"] = ""
        if "intake_preparation" not in df.columns:
            df["intake_preparation"] = ""
        if "occupancy_ratio" not in df.columns:
            df["occupancy_ratio"] = 0.5
        datasets[key] = df

    datasets["osm"] = _load_osm(pd_engine)
    datasets["stops"] = pd_engine.read_csv(
        GTFS_STOPS_TXT,
        usecols=["stop_id", "stop_name", "stop_lat", "stop_lon"],
    ).rename(columns={"stop_lat": "lat", "stop_lon": "lon"})

    elapsed_ms = (time.perf_counter() - t0) * 1000
    total = sum(len(d) for d in datasets.values())
    logger.info(f"[{mode.value.upper()}] loaded {total} records in {elapsed_ms:.0f}ms")
    return datasets, elapsed_ms


def _fetch_shelters_ckan(pd_engine):
    """
    Try live CKAN fetch to get fresh occupancy data.
    If CKAN lacks coordinates, use our pre-processed shelters.csv (which has lat/lon
    and eligibility flags). Never overwrites the local cache if CKAN data is incomplete.
    """
    try:
        import requests
        import pandas as pd

        r = requests.get(SHELTER_CKAN_URL, timeout=10)
        r.raise_for_status()
        body = r.json()
        if not body.get("success"):
            raise ValueError("CKAN returned success=false")
        records = body["result"]["records"]
        if not records:
            raise ValueError("CKAN returned 0 records")

        ckan_df = pd.DataFrame(records)

        # If CKAN data already has coordinates, use it directly and cache it
        if "LAT" in ckan_df.columns and "LON" in ckan_df.columns:
            ckan_df.to_csv(SHELTERS_CSV, index=False)
            return pd_engine.from_pandas(ckan_df) if hasattr(pd_engine, "from_pandas") else ckan_df

        # CKAN has no coordinates — use our local pre-processed file
        logger.info("CKAN has no coordinates — using local shelters.csv with cached coordinates")
        if not SHELTERS_CSV.exists():
            raise FileNotFoundError("No local shelters.csv to fall back to")

        local_df = pd.read_csv(SHELTERS_CSV)
        return pd_engine.from_pandas(local_df) if hasattr(pd_engine, "from_pandas") else local_df

    except Exception as e:
        logger.warning(f"CKAN fetch/merge failed ({e}), using local cache")
        return None


def refresh_shelters(datasets: dict, mode: EngineMode = EngineMode.CPU) -> bool:
    """Background re-hydration with 500ms fail-safe. Returns True if updated."""
    if mode == EngineMode.GPU:
        import cudf as pd_engine
    else:
        import pandas as pd_engine
    try:
        import requests
        r = requests.get(SHELTER_CKAN_URL, timeout=CKAN_HYDRATE_TIMEOUT)
        r.raise_for_status()
        body = r.json()
        if not body.get("success"):
            return False
        records = body["result"]["records"]
        if not records:
            return False
        ckan_df = pd_engine.DataFrame(records) if hasattr(pd_engine, "DataFrame") else __import__("pandas").DataFrame(records)
        if "LAT" not in ckan_df.columns:
            return False
        datasets["shelters"] = _standardize_coords(ckan_df, "LAT", "LON")
        logger.info("[HYDRATE] Shelter occupancy refreshed from CKAN")
        return True
    except Exception as e:
        logger.debug(f"[HYDRATE] 500ms cutoff or error: {e}")
        return False


def fetch_weather_alert() -> str | None:
    """
    Fetch Environment Canada RSS for Toronto warnings.
    Returns 'EXTREME_COLD', 'EXTREME_HEAT', or None.
    Governed by 500ms fail-safe.
    """
    global _weather_alert
    try:
        import requests
        r = requests.get(WEATHER_FEED_URL, timeout=WEATHER_TIMEOUT)
        r.raise_for_status()
        content = r.text.lower()
        if any(k in content for k in ["extreme cold", "wind chill warning", "frostbite"]):
            _weather_alert = "EXTREME_COLD"
        elif any(k in content for k in ["extreme heat", "heat warning", "humidex"]):
            _weather_alert = "EXTREME_HEAT"
        else:
            _weather_alert = None
        logger.info(f"[WEATHER] alert={_weather_alert}")
    except Exception as e:
        logger.debug(f"[WEATHER] 500ms cutoff or error ({e}), keeping previous: {_weather_alert}")
    return _weather_alert


def get_weather_alert() -> str | None:
    """Return cached weather alert (never blocks)."""
    return _weather_alert


def _load_osm(pd_engine):
    """Read osm_amenities.json and normalize to flat DataFrame."""
    import pandas as pd

    try:
        with open(OSM_JSON) as f:
            raw = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        logger.warning(f"OSM JSON load failed ({e}), using empty dataset")
        raw = {"elements": []}

    rows = []
    for el in raw.get("elements", []):
        try:
            lat = float(el.get("lat", 0.0))
            lon = float(el.get("lon", 0.0))
        except (ValueError, TypeError):
            continue
        tags = el.get("tags", {})
        rows.append({
            "osm_id":  el.get("id"),
            "name":    tags.get("name", "Public facility"),
            "amenity": tags.get("amenity") or tags.get("social_facility", "facility"),
            "lat":     lat,
            "lon":     lon,
        })

    df = pd.DataFrame(rows)
    df["requires_id"]       = False
    df["harm_reduction"]    = True
    df["bypass_pathway"]    = ""
    df["intake_preparation"] = ""
    df["occupancy_ratio"]   = 0.5
    df["phone"]             = ""
    df["hours"]             = "Open to public"

    return pd_engine.from_pandas(df) if hasattr(pd_engine, "from_pandas") else df


def _standardize_coords(df, lat_col: str = "lat", lon_col: str = "lon"):
    """Rename lat/lon column variants to lowercase lat/lon and cast to float32."""
    rename_map = {}
    for c in df.columns:
        cl = c.lower()
        if cl in ("latitude", "lat", "y") and c != "lat":
            rename_map[c] = "lat"
        if cl in ("longitude", "lon", "lng", "x") and c != "lon":
            rename_map[c] = "lon"
    if lat_col != "lat":
        rename_map[lat_col] = "lat"
    if lon_col != "lon":
        rename_map[lon_col] = "lon"
    if rename_map:
        df = df.rename(columns=rename_map)
    df["lat"] = df["lat"].astype("float32")
    df["lon"] = df["lon"].astype("float32")
    return df


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Load and verify Haven Matrix datasets")
    parser.add_argument("--verify", action="store_true", help="Print row counts and exit")
    parser.add_argument("--mode", choices=["gpu", "cpu"], default="gpu")
    args = parser.parse_args()

    mode = EngineMode.GPU if args.mode == "gpu" else EngineMode.CPU
    datasets, elapsed = load_all(mode)

    if args.verify:
        for name, df in datasets.items():
            print(f"  ✓ {name:<15} {len(df):>6} rows")
        print(f"\nTotal: {elapsed:.2f} ms  mode={mode.value}")
