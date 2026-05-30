"""
auth_store.py
SQLite-backed caseworker auth: bcrypt passwords, JWT tokens.
Stored in the same cases.db file as case history.
"""

import logging
import os
import sqlite3
import uuid
from datetime import datetime, timedelta

from passlib.context import CryptContext
from jose import JWTError, jwt

logger = logging.getLogger(__name__)

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

JWT_SECRET    = os.environ.get("JWT_SECRET", "haven-matrix-dev-secret-change-in-prod")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_H  = 24


class AuthStore:
    def __init__(self, db_path: str = "logs/cases.db"):
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
                CREATE TABLE IF NOT EXISTS users (
                    id            TEXT PRIMARY KEY,
                    email         TEXT UNIQUE NOT NULL,
                    name          TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    role          TEXT NOT NULL DEFAULT 'caseworker',
                    created_at    TEXT NOT NULL
                )
            """)
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_email ON users(email)")

    # ── User management ───────────────────────────────────────────────────────

    def create_user(self, email: str, name: str, password: str) -> dict:
        """Create a new user. Raises ValueError on duplicate email."""
        uid  = uuid.uuid4().hex[:12]
        now  = datetime.utcnow().isoformat()
        phash = _pwd.hash(password)
        try:
            with self._conn() as conn:
                conn.execute(
                    "INSERT INTO users (id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,'caseworker',?)",
                    (uid, email.lower().strip(), name.strip(), phash, now),
                )
        except sqlite3.IntegrityError:
            raise ValueError(f"Email already registered: {email}")
        return {"id": uid, "email": email, "name": name, "role": "caseworker"}

    def authenticate(self, email: str, password: str) -> dict | None:
        """Return user dict if credentials valid, else None."""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE email=?", (email.lower().strip(),)
            ).fetchone()
        if not row:
            return None
        if not _pwd.verify(password, row["password_hash"]):
            return None
        return {"id": row["id"], "email": row["email"], "name": row["name"], "role": row["role"]}

    def get_by_email(self, email: str) -> dict | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id,email,name,role FROM users WHERE email=?",
                (email.lower().strip(),),
            ).fetchone()
        return dict(row) if row else None

    # ── JWT ───────────────────────────────────────────────────────────────────

    def create_token(self, user: dict) -> str:
        exp = datetime.utcnow() + timedelta(hours=JWT_EXPIRE_H)
        return jwt.encode(
            {"sub": user["email"], "name": user["name"], "role": user["role"], "exp": exp},
            JWT_SECRET, algorithm=JWT_ALGORITHM,
        )

    @staticmethod
    def decode_token(token: str) -> dict | None:
        """Return payload dict or None if invalid/expired."""
        try:
            return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        except JWTError:
            return None
