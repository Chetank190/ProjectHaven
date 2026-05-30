"""
solver.py
Constraint-aware cuML KNN solver. Eligibility fields filter datasets before spatial solve.
Run: python backend/solver.py --benchmark
"""

import time
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from config import (
    EngineMode, KNN_RESULTS_PER_PILLAR, WEIGHT_DISTANCE,
    WEIGHT_OCCUPANCY, WEIGHT_TRANSIT, TRANSIT_RADIUS_M,
)
from nim_compiler import NeedsPayload


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

    return itinerary, (time.perf_counter() - t0) * 1000


def _apply_masks(payload: NeedsPayload, datasets: dict, pd_engine) -> dict:
    """Return dict of pillar_name → filtered DataFrame based on eligibility constraints."""
    masked = {}

    def elig(df):
        """Simplified eligibility mask that works for both pandas and cuDF."""
        try:
            m_id  = (df["requires_id"].astype(bool) == False) if (payload.has_id is False and "requires_id" in df.columns) else True
            m_sob = (df["harm_reduction"].astype(bool) == True) if (payload.sobriety_status == "using" and "harm_reduction" in df.columns) else True
            return m_id & m_sob
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

    return masked


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

    for idx, dist_km in zip(idx_list, dist_list):
        row = pdf.iloc[int(idx)]
        occ     = float(row.get("occupancy_ratio", 0.5) or 0.5)
        transit = _check_transit(float(row["lat"]), float(row["lon"]), stops_pdf)
        score   = (
            WEIGHT_DISTANCE  * (dist_km / max_dist) +
            WEIGHT_OCCUPANCY * occ +
            WEIGHT_TRANSIT   * (0.0 if transit else 1.0)
        )

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
            "phone":              str(row.get("phone", "")),
            "hours":              str(row.get("hours", "")),
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
