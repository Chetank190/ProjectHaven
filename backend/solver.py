"""
solver.py
Constraint-aware cuML KNN solver. Eligibility fields filter datasets before spatial solve.
Run: python backend/solver.py --benchmark
"""

import logging
import re
import time
import argparse
import sys
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

sys.path.insert(0, str(Path(__file__).parent))

from config import (
    EngineMode, KNN_RESULTS_PER_PILLAR, WEIGHT_DISTANCE,
    WEIGHT_OCCUPANCY, WEIGHT_TRANSIT, TRANSIT_RADIUS_M,
)
from nim_compiler import NeedsPayload
from data_ingestion import get_weather_alert


def solve(
    payload: NeedsPayload,
    datasets: dict,
    origin: tuple[float, float],
    mode: EngineMode = EngineMode.GPU,
) -> tuple[dict, float]:
    """Run constraint-masked KNN solve. Returns (itinerary_dict, solve_time_ms)."""
    if mode == EngineMode.GPU:
        from cuml.neighbors import NearestNeighbors
        import cudf as pd_engine
        import cupy as np_engine
    else:
        from sklearn.neighbors import NearestNeighbors
        import pandas as pd_engine
        import numpy as np_engine

    t0 = time.perf_counter()
    masked = _apply_masks(payload, datasets, pd_engine)
    logger.info(
        f"solve start mode={mode.value} origin={origin} "
        f"pillars={list(masked.keys())}"
    )
    origin_arr = np_engine.array([[origin[0], origin[1]]], dtype="float32")
    itinerary = {}

    for pillar_name, df in masked.items():
        if df is None or len(df) == 0:
            itinerary[pillar_name] = []
            continue

        coords = df[["lat", "lon"]].values.astype("float32")
        k = min(KNN_RESULTS_PER_PILLAR * 3, len(df))

        knn = NearestNeighbors(n_neighbors=k, metric="haversine", algorithm="brute")
        knn.fit(np_engine.deg2rad(coords))
        distances, indices = knn.kneighbors(np_engine.deg2rad(origin_arr))
        distances_km = distances * 6371.0

        results = _score_and_rank(df, indices, distances_km, datasets["stops"], pillar_name)
        itinerary[pillar_name] = results[:KNN_RESULTS_PER_PILLAR]

    elapsed = (time.perf_counter() - t0) * 1000
    logger.info(
        f"solve done {elapsed:.1f}ms "
        f"results={' '.join(f'{k}:{len(v)}' for k,v in itinerary.items())}"
    )
    return itinerary, elapsed


def _apply_masks(payload: NeedsPayload, datasets: dict, pd_engine) -> dict:
    """Return dict of pillar_name → filtered DataFrame based on eligibility constraints."""
    masked = {}

    def elig(df):
        """Eligibility mask — always returns a boolean Series, never a bare True."""
        try:
            import pandas as _pd
            mask = _pd.Series([True] * len(df), index=df.index if hasattr(df, "index") else range(len(df)))
            # Conservative: exclude ID-required facilities unless we *know* the person has ID.
            # has_id=None means "not asked" — same as False to avoid a door rejection.
            if payload.has_id is not True and "requires_id" in df.columns:
                mask = mask & (df["requires_id"].astype(bool) == False)
            if payload.sobriety_status == "using" and "harm_reduction" in df.columns:
                mask = mask & (df["harm_reduction"].astype(bool) == True)
            return mask
        except Exception:
            return [True] * len(df)

    if payload.needs_shelter:
        df = datasets["shelters"]
        m = (df["UNOCCUPIED_BEDS"].astype(float) > 0) & elig(df)
        if payload.sector != "any":
            sector_map = {
                "youth":  ["Youth"],
                "adult":  ["Men", "Women", "Co-ed", "Mixed Adult"],
                "family": ["Families"],
            }
            allowed = sector_map.get(payload.sector, [])
            m = m & df["SECTOR"].isin(allowed)
        if payload.group_size == "with_family":
            m = m & df["SECTOR"].isin(["Families"])
        masked["shelter"] = df[m].copy()

    if payload.needs_rehab:
        df = datasets["rehab"]
        masked["rehab"] = df[elig(df)].copy()

    if payload.needs_food:
        try:
            food_all = pd_engine.concat([datasets["food"], datasets["grassroots"]])
        except Exception:
            import pandas as pd
            food_all = pd.concat([
                datasets["food"].to_pandas() if hasattr(datasets["food"], "to_pandas") else datasets["food"],
                datasets["grassroots"].to_pandas() if hasattr(datasets["grassroots"], "to_pandas") else datasets["grassroots"],
            ])
        masked["food"] = food_all.copy()

    if payload.needs_supplies:
        df = datasets["hygiene"]
        m = elig(df)
        if "has_winter_clothing" in df.columns:
            m = m & (df["has_winter_clothing"].astype(bool) == True)
        masked["supplies"] = df[m].copy()

    if payload.needs_hygiene:
        try:
            hygiene_all = pd_engine.concat([datasets["hygiene"], datasets["osm"]])
        except Exception:
            import pandas as pd
            hygiene_all = pd.concat([
                datasets["hygiene"].to_pandas() if hasattr(datasets["hygiene"], "to_pandas") else datasets["hygiene"],
                datasets["osm"].to_pandas() if hasattr(datasets["osm"], "to_pandas") else datasets["osm"],
            ])
        masked["hygiene"] = hygiene_all.copy()

    # ── Upstream prevention pillars ───────────────────────────────────────────
    if payload.needs_respite:
        df = datasets.get("respite")
        if df is not None:
            masked["respite"] = df[elig(df)].copy()

    if payload.needs_youth_service:
        df = datasets.get("youth_spaces")
        if df is not None:
            masked["youth"] = df.copy()

    if payload.needs_library:
        df = datasets.get("libraries")
        if df is not None:
            masked["library"] = df.copy()

    # ── Weather boost: during EXTREME_COLD, inject respite into shelter pool ─
    weather = get_weather_alert()
    if weather == "EXTREME_COLD" and "shelter" in masked and datasets.get("respite") is not None:
        try:
            respite_df = datasets["respite"]
            masked["shelter"] = pd_engine.concat([masked["shelter"], respite_df])
            logger.info("[WEATHER] Extreme cold — respite sites added to shelter pool")
        except Exception:
            import pandas as pd
            s = masked["shelter"].to_pandas() if hasattr(masked["shelter"], "to_pandas") else masked["shelter"]
            r = respite_df.to_pandas() if hasattr(respite_df, "to_pandas") else respite_df
            masked["shelter"] = pd.concat([s, r])

    return masked


def is_open_now(hours_str: str, now: datetime = None) -> bool:
    """
    Parse common hours-string formats and check if the facility is currently open.
    Fails open (returns True) when hours are missing or unparseable — we never
    penalize a user for our inability to read the data.
    """
    if not hours_str:
        return True
    h = hours_str.strip().lower()
    if h in ("", "n/a", "na", "unknown", "varies", "call for hours"):
        return True
    if re.search(r"24[/\s]?7|24\s*hours?|open\s*24|always\s*open", h):
        return True

    now = now or datetime.now()
    cur_day  = now.weekday()          # 0=Mon … 6=Sun
    cur_min  = now.hour * 60 + now.minute

    _DAY = {
        "mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6,
        "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
        "friday": 4, "saturday": 5, "sunday": 6,
    }

    def _parse_time(s: str) -> int:
        s = s.strip().lower().replace(".", ":")
        pm = "pm" in s
        am = "am" in s
        s  = re.sub(r"[ap]m", "", s).strip()
        pts = re.split(r"[:\s]", s)
        try:
            hv = int(pts[0])
            mv = int(pts[1]) if len(pts) > 1 else 0
        except (ValueError, IndexError):
            return -1
        if pm and hv != 12:
            hv += 12
        if am and hv == 12:
            hv = 0
        return hv * 60 + mv

    def _parse_days(s: str) -> list[int]:
        s = s.strip().lower()
        if s in ("daily", "every day", "7 days", "all week", "weekdays & weekends"):
            return list(range(7))
        if s in ("weekdays", "monday to friday", "mon-fri", "mon to fri"):
            return list(range(5))
        if s in ("weekends",):
            return [5, 6]
        m = re.search(r"(\w+)\s*(?:[-–]|to)\s*(\w+)", s)
        if m:
            a, b = _DAY.get(m.group(1)), _DAY.get(m.group(2))
            if a is not None and b is not None:
                return list(range(a, b + 1)) if b >= a else list(range(a, 7)) + list(range(0, b + 1))
        d = _DAY.get(s)
        return [d] if d is not None else list(range(7))

    def _in_range(open_t: int, close_t: int) -> bool:
        if open_t < 0 or close_t < 0:
            return True  # unparseable → fail open
        if close_t > open_t:
            return open_t <= cur_min <= close_t
        return cur_min >= open_t or cur_min <= close_t  # overnight

    # Pattern: "Day(s) HH:MM[am/pm] - HH:MM[am/pm]"
    m = re.search(
        r"([a-z\s\-–to]+?)\s+"
        r"(\d{1,2}[:.]\d{2}(?:\s*[ap]m)?|\d{1,2}\s*[ap]m)"
        r"\s*[-–to]+\s*"
        r"(\d{1,2}[:.]\d{2}(?:\s*[ap]m)?|\d{1,2}\s*[ap]m)",
        h,
    )
    if m:
        days = _parse_days(m.group(1))
        if cur_day in days:
            return _in_range(_parse_time(m.group(2)), _parse_time(m.group(3)))
        return False

    # Pattern: time range only (applies every day) "9:00 am - 5:00 pm"
    m = re.search(
        r"(\d{1,2}[:.]\d{2}(?:\s*[ap]m)?|\d{1,2}\s*[ap]m)"
        r"\s*[-–to]+\s*"
        r"(\d{1,2}[:.]\d{2}(?:\s*[ap]m)?|\d{1,2}\s*[ap]m)",
        h,
    )
    if m:
        return _in_range(_parse_time(m.group(1)), _parse_time(m.group(2)))

    return True  # unrecognised format → fail open


def _score_and_rank(df, indices, distances_km, stops_df, pillar_name: str) -> list:
    """Compute composite score and return sorted result list."""
    try:
        idx_list  = indices[0].tolist()
        dist_list = distances_km[0].tolist()
    except Exception:
        idx_list  = list(indices[0])
        dist_list = list(distances_km[0])

    max_dist = max(dist_list) if dist_list else 1.0
    max_dist = max_dist if max_dist > 0 else 1.0
    results = []

    # Convert to pandas for row-level access (works for both pandas and cuDF)
    pdf = df.to_pandas() if hasattr(df, "to_pandas") else df
    stops_pdf = stops_df.to_pandas() if hasattr(stops_df, "to_pandas") else stops_df

    now = datetime.now()
    for idx, dist_km in zip(idx_list, dist_list):
        row     = pdf.iloc[int(idx)]
        occ_raw = row.get("occupancy_ratio")
        occ     = float(occ_raw) if occ_raw is not None else 0.5
        transit = _check_transit(float(row["lat"]), float(row["lon"]), stops_pdf)
        hours   = str(row.get("hours", ""))
        open_now = is_open_now(hours, now)
        score   = (
            WEIGHT_DISTANCE  * (dist_km / max_dist) +
            WEIGHT_OCCUPANCY * occ +
            WEIGHT_TRANSIT   * (0.0 if transit else 1.0)
        )
        # Closed facilities sink to the bottom; never hidden in case they're the only option
        if not open_now:
            score += 2.0

        results.append({
            "pillar":             pillar_name,
            "name":               str(
                row.get("organization_name") or
                row.get("ORGANIZATION_NAME") or
                row.get("name") or
                "Unknown"
            ),
            "address":            str(
                row.get("address") or
                row.get("SHELTER_ADDRESS") or
                row.get("LOCATION_ADDRESS") or
                ""
            ),
            "lat":                float(row["lat"]),
            "lon":                float(row["lon"]),
            "distance_km":        round(dist_km, 2),
            "distance_walk_min":  round(dist_km / 0.084, 0),
            "occupancy_ratio":    round(occ, 2),
            "transit_accessible": transit,
            "composite_score":    round(score, 4),
            "open_now":           open_now,
            "phone":              str(row.get("phone", "")),
            "hours":              hours,
            "requires_id":        bool(row.get("requires_id", False)),
            "harm_reduction":     bool(row.get("harm_reduction", True)),
            "bypass_pathway":     str(row.get("bypass_pathway", "")),
            "intake_preparation": str(row.get("intake_preparation", "")),
            "accessible":         True,
        })

    return sorted(results, key=lambda x: x["composite_score"])


def _check_transit(lat: float, lon: float, stops_df) -> bool:
    """Bounding-box transit proximity check (fast approximation — no haversine)."""
    try:
        lat_deg = TRANSIT_RADIUS_M / 111_000
        lon_deg = TRANSIT_RADIUS_M / 80_000
        nearby = stops_df[
            (abs(stops_df["lat"] - lat) < lat_deg) &
            (abs(stops_df["lon"] - lon) < lon_deg)
        ]
        return len(nearby) > 0
    except Exception:
        return False


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run KNN benchmark")
    parser.add_argument("--benchmark", action="store_true")
    args = parser.parse_args()

    if args.benchmark:
        from data_ingestion import load_all

        test_payload = NeedsPayload(
            needs_shelter=True, needs_rehab=True, needs_food=True,
            needs_supplies=False, needs_hygiene=True,
            sector="adult", has_id=False, sobriety_status="using", group_size="alone",
        )
        origin = (43.6532, -79.3832)

        print("Loading CPU datasets...")
        dc, _ = load_all(EngineMode.CPU)
        _, cms = solve(test_payload, dc, origin, EngineMode.CPU)

        try:
            print("Loading GPU datasets...")
            dg, _ = load_all(EngineMode.GPU)
            _, gms = solve(test_payload, dg, origin, EngineMode.GPU)
            speedup = cms / gms if gms > 0 else None
            print(f"GPU: {gms:.2f}ms  CPU: {cms:.2f}ms  Speedup: {speedup:.1f}×")
        except Exception as e:
            print(f"GPU unavailable ({e})")
            print(f"CPU: {cms:.2f}ms  (GPU requires RAPIDS container on GX10)")
