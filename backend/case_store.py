"""
case_store.py
SQLite-backed case history for caseworker referrals.
Semantic similarity via TF-IDF (sklearn — already in requirements, no extra deps).

Upgrade path: swap find_similar() for ChromaDB + sentence-transformers when you
want real dense-vector search in production.
"""

import json
import logging
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

OUTCOME_VALID = {"pending", "placed", "declined", "returned", "referred_elsewhere"}


class CaseStore:
    def __init__(self, db_path: str = "logs/cases.db"):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._path = db_path
        self._init_db()

    # ── Internal ──────────────────────────────────────────────────────────────

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")   # safe for concurrent FastAPI requests
        return conn

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS cases (
                    id            TEXT PRIMARY KEY,
                    caseworker_id TEXT NOT NULL DEFAULT 'unknown',
                    client_name   TEXT,
                    created_at    TEXT NOT NULL,
                    transcript    TEXT NOT NULL,
                    needs_json    TEXT,
                    itinerary_json TEXT,
                    ticket_text   TEXT,
                    outcome       TEXT NOT NULL DEFAULT 'pending',
                    outcome_notes TEXT,
                    updated_at    TEXT NOT NULL
                )
            """)
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_cw ON cases(caseworker_id, created_at DESC)"
            )

    # ── Public API ────────────────────────────────────────────────────────────

    def save_case(
        self,
        caseworker_id: str,
        client_name: str | None,
        transcript: str,
        needs_payload: dict | None,
        itinerary: dict | None,
        ticket_text: str | None,
    ) -> str:
        case_id = uuid.uuid4().hex[:8]
        now = datetime.utcnow().isoformat()
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO cases
                  (id, caseworker_id, client_name, created_at, transcript,
                   needs_json, itinerary_json, ticket_text, outcome, updated_at)
                VALUES (?,?,?,?,?,?,?,?,'pending',?)
                """,
                (
                    case_id,
                    caseworker_id or "unknown",
                    client_name or "",
                    now,
                    transcript,
                    json.dumps(needs_payload) if needs_payload else None,
                    json.dumps(itinerary)     if itinerary     else None,
                    ticket_text,
                    now,
                ),
            )
        logger.debug(f"[case_store] saved case={case_id} caseworker={caseworker_id}")
        return case_id

    def get_history(self, caseworker_id: str, limit: int = 30) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM cases WHERE caseworker_id=? ORDER BY created_at DESC LIMIT ?",
                (caseworker_id, limit),
            ).fetchall()
        return [dict(r) for r in rows]

    def update_outcome(self, case_id: str, outcome: str, notes: str = "") -> bool:
        if outcome not in OUTCOME_VALID:
            logger.warning(f"[case_store] invalid outcome '{outcome}' for case={case_id}")
            return False
        now = datetime.utcnow().isoformat()
        with self._conn() as conn:
            cur = conn.execute(
                "UPDATE cases SET outcome=?, outcome_notes=?, updated_at=? WHERE id=?",
                (outcome, notes or "", now, case_id),
            )
        return cur.rowcount > 0

    def find_similar(self, transcript: str, limit: int = 3) -> list[dict]:
        """
        Return up to `limit` past cases whose transcripts are most similar
        to `transcript` using TF-IDF cosine similarity.
        Only considers cases that have been resolved (outcome != 'pending')
        so the LLM gets signal about what actually worked.
        """
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT id, transcript, outcome, itinerary_json, client_name, created_at "
                "FROM cases WHERE outcome != 'pending' ORDER BY created_at DESC LIMIT 200"
            ).fetchall()

        if not rows:
            return []

        try:
            from sklearn.feature_extraction.text import TfidfVectorizer
            from sklearn.metrics.pairwise import cosine_similarity
            import numpy as np

            past = [r["transcript"] for r in rows]
            vec = TfidfVectorizer(stop_words="english", max_features=1000, sublinear_tf=True)
            matrix = vec.fit_transform(past + [transcript])
            sims = cosine_similarity(matrix[-1], matrix[:-1])[0]

            top_idx = np.argsort(sims)[::-1][:limit]
            results = []
            for i in top_idx:
                if sims[i] < 0.08:    # skip near-zero matches
                    continue
                row = dict(rows[i])
                row["similarity"] = round(float(sims[i]), 3)
                # Surface the first shelter from the itinerary for the LLM hint
                if row.get("itinerary_json"):
                    itin = json.loads(row["itinerary_json"])
                    shelters = itin.get("shelter", [])
                    row["placed_at"] = shelters[0]["name"] if shelters else None
                else:
                    row["placed_at"] = None
                results.append(row)
            return results

        except Exception as exc:
            logger.warning(f"[case_store] TF-IDF similarity failed: {exc}")
            return []
