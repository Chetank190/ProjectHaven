"""
reservation_store.py
SQLite-backed kiosk reservation codes.
Codes are stored in the same DB as cases (logs/cases.db) for simplicity.
"""

import logging
import random
import sqlite3
import string
from datetime import datetime, timedelta
from pathlib import Path

logger = logging.getLogger(__name__)

_ALPHABET = string.ascii_uppercase + string.digits  # A-Z 0-9


def _gen_code() -> str:
    """Return a human-readable 8-char code like HVN-3X7K."""
    suffix = "".join(random.choices(_ALPHABET, k=4))
    return f"HVN-{suffix}"


class ReservationStore:
    def __init__(self, db_path: str = "logs/cases.db"):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._path = db_path
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS reservations (
                    code             TEXT PRIMARY KEY,
                    session_id       TEXT NOT NULL,
                    facility_name    TEXT NOT NULL,
                    facility_address TEXT NOT NULL,
                    pillar           TEXT NOT NULL,
                    created_at       TEXT NOT NULL,
                    expires_at       TEXT NOT NULL,
                    status           TEXT NOT NULL DEFAULT 'active'
                )
            """)
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_res_status ON reservations(status, expires_at)"
            )

    def create(
        self,
        session_id: str,
        facility_name: str,
        facility_address: str,
        pillar: str,
        ttl_hours: int = 24,
    ) -> dict:
        now = datetime.utcnow()
        expires = now + timedelta(hours=ttl_hours)
        for _ in range(5):
            code = _gen_code()
            try:
                with self._conn() as conn:
                    conn.execute(
                        """INSERT INTO reservations
                           (code, session_id, facility_name, facility_address,
                            pillar, created_at, expires_at, status)
                           VALUES (?,?,?,?,?,?,?,'active')""",
                        (
                            code, session_id, facility_name, facility_address,
                            pillar, now.isoformat(), expires.isoformat(),
                        ),
                    )
                logger.info(f"[reservation] created code={code} facility={facility_name!r}")
                return {
                    "code":             code,
                    "facility_name":    facility_name,
                    "facility_address": facility_address,
                    "pillar":           pillar,
                    "expires_at":       expires.isoformat(),
                }
            except sqlite3.IntegrityError:
                continue
        raise RuntimeError("Could not generate unique reservation code after 5 attempts")

    def lookup(self, code: str) -> dict | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM reservations WHERE code=?", (code.upper(),)
            ).fetchone()
        if row is None:
            return None
        r = dict(row)
        if r["status"] == "active":
            expires = datetime.fromisoformat(r["expires_at"])
            if datetime.utcnow() > expires:
                self._set_status(code, "expired")
                r["status"] = "expired"
        return r

    def redeem(self, code: str) -> bool:
        with self._conn() as conn:
            cur = conn.execute(
                "UPDATE reservations SET status='redeemed' WHERE code=? AND status='active'",
                (code.upper(),),
            )
        return cur.rowcount > 0

    def _set_status(self, code: str, status: str) -> None:
        with self._conn() as conn:
            conn.execute("UPDATE reservations SET status=? WHERE code=?", (status, code))
