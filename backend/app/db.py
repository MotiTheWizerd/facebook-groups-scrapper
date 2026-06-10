"""
SQLite persistence for the scraper.

Data model:
  groups        — one row per FB group the client registers
  people        — one row per unique FB user (across ALL groups), the cross-ref pool
  group_people  — link table: which person appeared in which group, when
  jobs          — one row per scrape run, with status + outcome

WAL mode + per-call connections so the background scrape thread can write while
the SSE/API connections read. Repository functions are plain and explicit.
"""
from __future__ import annotations

import pathlib
import re
import sqlite3
import time
import uuid

DB_PATH = pathlib.Path(__file__).resolve().parents[1] / "data" / "scraper.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS groups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    url         TEXT UNIQUE NOT NULL,
    fb_group_id TEXT,
    name        TEXT,
    created_at  REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS people (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT UNIQUE NOT NULL,
    name         TEXT NOT NULL,
    profile_url  TEXT NOT NULL,
    avatar_url   TEXT NOT NULL DEFAULT '',
    is_anonymous INTEGER NOT NULL DEFAULT 0,
    first_seen   REAL NOT NULL,
    last_seen    REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS group_people (
    group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    person_id  INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    scraped_at REAL NOT NULL,
    PRIMARY KEY (group_id, person_id)
);
CREATE TABLE IF NOT EXISTS jobs (
    id          TEXT PRIMARY KEY,
    group_id    INTEGER REFERENCES groups(id) ON DELETE CASCADE,
    status      TEXT NOT NULL,
    scrolls     INTEGER,
    found       INTEGER DEFAULT 0,
    new_found   INTEGER DEFAULT 0,
    reason      TEXT,
    error       TEXT,
    started_at  REAL,
    finished_at REAL
);
"""

# FB anonymized members look like "AdventurousGoldfish2855".
_ANON_RE = re.compile(r"^[A-Z][a-z]+[A-Z][a-z]+\d{2,}$")
_GID_RE = re.compile(r"/groups/([^/?#]+)")


def connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    return con


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = connect()
    con.executescript(_SCHEMA)
    # Lightweight migration for DBs created before avatar_url existed.
    cols = {r["name"] for r in con.execute("PRAGMA table_info(people)")}
    if "avatar_url" not in cols:
        con.execute("ALTER TABLE people ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''")
    con.commit()
    con.close()


def extract_group_id(url: str) -> str | None:
    m = _GID_RE.search(url)
    return m.group(1) if m else None


def is_anonymous(name: str) -> bool:
    return bool(_ANON_RE.match(name))


# ---------- groups ----------

def add_group(url: str, name: str | None = None) -> dict:
    now = time.time()
    fb_id = extract_group_id(url)
    con = connect()
    try:
        cur = con.execute(
            "INSERT INTO groups (url, fb_group_id, name, created_at) VALUES (?,?,?,?) "
            "ON CONFLICT(url) DO UPDATE SET name=COALESCE(excluded.name, groups.name) "
            "RETURNING *",
            (url, fb_id, name, now),
        )
        row = cur.fetchone()
        con.commit()
        return dict(row)
    finally:
        con.close()


def get_group(group_id: int) -> dict | None:
    con = connect()
    try:
        row = con.execute("SELECT * FROM groups WHERE id=?", (group_id,)).fetchone()
        return dict(row) if row else None
    finally:
        con.close()


def list_groups() -> list[dict]:
    con = connect()
    try:
        rows = con.execute(
            "SELECT g.*, "
            "  (SELECT COUNT(*) FROM group_people gp WHERE gp.group_id=g.id) AS people_count "
            "FROM groups g ORDER BY g.created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        con.close()


# ---------- people ----------

def upsert_people(group_id: int, people: list[dict]) -> int:
    """Insert/refresh people and link them to the group. Returns # new globally."""
    now = time.time()
    new_count = 0
    con = connect()
    try:
        for p in people:
            anon = 1 if is_anonymous(p["name"]) else 0
            avatar = p.get("avatar_url", "") or ""
            cur = con.execute(
                "INSERT INTO people (user_id, name, profile_url, avatar_url, "
                "is_anonymous, first_seen, last_seen) VALUES (?,?,?,?,?,?,?) "
                "ON CONFLICT(user_id) DO UPDATE SET "
                "  name=excluded.name, profile_url=excluded.profile_url, "
                "  is_anonymous=excluded.is_anonymous, last_seen=excluded.last_seen, "
                # keep an existing avatar if the new scrape didn't capture one
                "  avatar_url=CASE WHEN excluded.avatar_url != '' "
                "    THEN excluded.avatar_url ELSE people.avatar_url END",
                (p["user_id"], p["name"], p["profile_url"], avatar, anon, now, now),
            )
            if cur.rowcount == 1 and cur.lastrowid:
                # Could be insert or update; detect true insert via first_seen==last_seen.
                pass
            pid = con.execute(
                "SELECT id FROM people WHERE user_id=?", (p["user_id"],)
            ).fetchone()["id"]
            link = con.execute(
                "INSERT OR IGNORE INTO group_people (group_id, person_id, scraped_at) "
                "VALUES (?,?,?)",
                (group_id, pid, now),
            )
            if link.rowcount == 1:
                new_count += 1
        con.commit()
        return new_count
    finally:
        con.close()


def list_people(group_id: int | None = None, include_anon: bool = True) -> list[dict]:
    con = connect()
    try:
        where, params = [], []
        if group_id is not None:
            base = ("SELECT p.* FROM people p "
                    "JOIN group_people gp ON gp.person_id=p.id WHERE gp.group_id=?")
            params.append(group_id)
        else:
            base = "SELECT p.* FROM people p WHERE 1=1"
        if not include_anon:
            base += " AND p.is_anonymous=0"
        base += " ORDER BY p.name COLLATE NOCASE"
        rows = con.execute(base, params).fetchall()
        return [dict(r) for r in rows]
    finally:
        con.close()


def list_people_page(
    group_id: int | None,
    include_anon: bool = True,
    q: str = "",
    page: int = 1,
    per_page: int = 50,
) -> dict:
    """Paged + searchable people listing. Search and filtering run in SQL so
    groups with tens of thousands of members never travel over the wire whole."""
    con = connect()
    try:
        params: list = []
        if group_id is not None:
            base = ("FROM people p JOIN group_people gp ON gp.person_id=p.id "
                    "WHERE gp.group_id=?")
            params.append(group_id)
        else:
            base = "FROM people p WHERE 1=1"
        if not include_anon:
            base += " AND p.is_anonymous=0"
        if q:
            base += " AND (p.name LIKE ? COLLATE NOCASE OR p.user_id LIKE ?)"
            like = f"%{q}%"
            params.extend([like, like])

        total = con.execute(f"SELECT COUNT(*) {base}", params).fetchone()[0]
        anon_count = con.execute(
            f"SELECT COUNT(*) {base} AND p.is_anonymous=1", params
        ).fetchone()[0]

        per_page = max(1, min(per_page, 200))
        pages = max(1, -(-total // per_page))  # ceil
        page = max(1, min(page, pages))
        rows = con.execute(
            f"SELECT p.* {base} ORDER BY p.name COLLATE NOCASE LIMIT ? OFFSET ?",
            [*params, per_page, (page - 1) * per_page],
        ).fetchall()
        return {
            "items": [dict(r) for r in rows],
            "total": total,
            "anon_count": anon_count,
            "page": page,
            "per_page": per_page,
            "pages": pages,
        }
    finally:
        con.close()


# ---------- jobs ----------

def create_job(group_id: int, scrolls: int) -> str:
    job_id = uuid.uuid4().hex[:12]
    con = connect()
    try:
        con.execute(
            "INSERT INTO jobs (id, group_id, status, scrolls, started_at) "
            "VALUES (?,?,?,?,?)",
            (job_id, group_id, "pending", scrolls, time.time()),
        )
        con.commit()
        return job_id
    finally:
        con.close()


def update_job(job_id: str, **fields) -> None:
    if not fields:
        return
    cols = ", ".join(f"{k}=?" for k in fields)
    con = connect()
    try:
        con.execute(f"UPDATE jobs SET {cols} WHERE id=?", (*fields.values(), job_id))
        con.commit()
    finally:
        con.close()


def get_job(job_id: str) -> dict | None:
    con = connect()
    try:
        row = con.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        return dict(row) if row else None
    finally:
        con.close()


def list_jobs(limit: int = 50) -> list[dict]:
    con = connect()
    try:
        rows = con.execute(
            "SELECT * FROM jobs ORDER BY started_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        con.close()
