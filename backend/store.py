"""Local SQLite record of who was in each meeting and who spoke, with server timestamps.

The database file is backend/data/studio.db (override with the STUDIO_DB environment variable).
"""
import hashlib
import os
import sqlite3
import threading
import time
from pathlib import Path

DB_PATH = Path(os.getenv("STUDIO_DB", Path(__file__).resolve().parent / "data" / "studio.db"))
_lock = threading.Lock()
_db: sqlite3.Connection | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS meetings (
  room_id TEXT PRIMARY KEY, host_token_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL, peer_id TEXT NOT NULL,
  name TEXT NOT NULL, role TEXT NOT NULL, joined_at INTEGER NOT NULL, left_at INTEGER,
  last_seen_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS speaking (
  id INTEGER PRIMARY KEY AUTOINCREMENT, participant_id INTEGER NOT NULL,
  started_at INTEGER NOT NULL, ended_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_part_room ON participants(room_id);
CREATE INDEX IF NOT EXISTS idx_speak_part ON speaking(participant_id);
"""


def _now() -> int:
    return int(time.time() * 1000)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def init() -> None:
    global _db
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    _db = sqlite3.connect(DB_PATH, check_same_thread=False)
    _db.row_factory = sqlite3.Row
    _db.executescript(SCHEMA)
    # After a crash some rows are still open. Close them at the last moment we heard from that person,
    # which is conservative: it never invents speaking time.
    _db.execute("UPDATE speaking SET ended_at = MAX(started_at, (SELECT last_seen_at FROM participants p "
                "WHERE p.id = speaking.participant_id)) WHERE ended_at IS NULL")
    _db.execute("UPDATE participants SET left_at = last_seen_at WHERE left_at IS NULL")
    _db.commit()


def _run(sql: str, args: tuple = ()):
    with _lock:
        cur = _db.execute(sql, args)
        _db.commit()
        return cur


def create_meeting(room_id: str, host_token: str) -> None:
    _run("INSERT INTO meetings VALUES (?,?,?)", (room_id, _hash(host_token), _now()))


def meeting_exists(room_id: str) -> bool:
    """True if this room was ever created. Used by rooms.get_room() to rebuild
    live state for a meeting that was created before a server restart."""
    with _lock:
        row = _db.execute("SELECT 1 FROM meetings WHERE room_id=?", (room_id,)).fetchone()
    return row is not None


def is_host(room_id: str, token: str) -> bool:
    with _lock:
        row = _db.execute("SELECT host_token_hash FROM meetings WHERE room_id=?", (room_id,)).fetchone()
    return bool(row and token and row["host_token_hash"] == _hash(token))


def add_participant(room_id: str, peer_id: str, name: str, role: str) -> int:
    t = _now()
    return _run("INSERT INTO participants (room_id,peer_id,name,role,joined_at,last_seen_at) VALUES (?,?,?,?,?,?)",
                (room_id, peer_id, name, role, t, t)).lastrowid


def touch(pid: int) -> None:
    _run("UPDATE participants SET last_seen_at=? WHERE id=?", (_now(), pid))


def set_speaking(pid: int, active: bool) -> None:
    t = _now()
    with _lock:
        open_seg = _db.execute("SELECT id FROM speaking WHERE participant_id=? AND ended_at IS NULL", (pid,)).fetchone()
        if active and not open_seg:
            _db.execute("INSERT INTO speaking (participant_id, started_at) VALUES (?,?)", (pid, t))
        elif not active and open_seg:
            _db.execute("UPDATE speaking SET ended_at=? WHERE id=?", (t, open_seg["id"]))
        _db.commit()


def participant_left(pid: int) -> None:
    t = _now()
    _run("UPDATE speaking SET ended_at=? WHERE participant_id=? AND ended_at IS NULL", (t, pid))
    _run("UPDATE participants SET left_at=?, last_seen_at=? WHERE id=?", (t, t, pid))


def report(room_id: str) -> dict:
    now = _now()
    with _lock:
        meeting = _db.execute("SELECT created_at FROM meetings WHERE room_id=?", (room_id,)).fetchone()
        parts = _db.execute("SELECT * FROM participants WHERE room_id=? ORDER BY joined_at", (room_id,)).fetchall()
        segs = _db.execute("SELECT s.* FROM speaking s JOIN participants p ON p.id=s.participant_id "
                           "WHERE p.room_id=? ORDER BY s.started_at", (room_id,)).fetchall()
    by_id = {p["id"]: p for p in parts}
    segments, per_part = [], {}
    for s in segs:
        end = s["ended_at"] if s["ended_at"] is not None else now
        ms = max(0, end - s["started_at"])
        p = by_id[s["participant_id"]]
        segments.append({"name": p["name"], "role": p["role"], "startedAt": s["started_at"],
                         "endedAt": s["ended_at"], "ms": ms})
        agg = per_part.setdefault(p["id"], [0, 0])
        agg[0] += ms
        agg[1] += 1
    participants = [{"name": p["name"], "role": p["role"], "joinedAt": p["joined_at"], "leftAt": p["left_at"],
                     "speakingMs": per_part.get(p["id"], [0, 0])[0], "turns": per_part.get(p["id"], [0, 0])[1]}
                    for p in parts]
    totals: dict[str, dict] = {}
    for p in participants:  # one person can reconnect: add their connections together by name
        t = totals.setdefault(p["name"], {"name": p["name"], "speakingMs": 0, "turns": 0})
        t["speakingMs"] += p["speakingMs"]
        t["turns"] += p["turns"]
    speakers = sorted(totals.values(), key=lambda x: -x["speakingMs"])
    return {"roomId": room_id, "createdAt": meeting["created_at"] if meeting else None, "generatedAt": now,
            "speakers": speakers, "participants": participants, "segments": segments}


def backup() -> Path:
    """Copy the database to a timestamped .bak file next to it. Uses sqlite3's
    online backup API, so it is safe to call while the app is running."""
    target = DB_PATH.parent / f"{DB_PATH.stem}.{int(time.time())}.bak"
    with _lock:
        dst = sqlite3.connect(target)
        try:
            _db.backup(dst)
        finally:
            dst.close()
    return target