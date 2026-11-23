"""Settings in one place. Everything can be overridden with environment variables."""
import os
from pathlib import Path

MAX_PEERS = int(os.getenv("MAX_PEERS", "6"))          # 1 host + 5 guests = 6 total
MAX_MESSAGE_CHARS = int(os.getenv("MAX_MESSAGE_CHARS", "64000"))  # far larger than any real signaling message
BACKUP_EVERY_SECONDS = 1800
DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"


def ice_servers() -> list[dict]:
    servers: list[dict] = [{"urls": "stun:stun.l.google.com:19302"}]
    turn = os.getenv("TURN_URL")  # comma separated, e.g. turn:host:3478,turns:host:5349
    if turn:
        servers.append({
            "urls": [u.strip() for u in turn.split(",")],
            "username": os.getenv("TURN_USERNAME", ""),
            "credential": os.getenv("TURN_CREDENTIAL", ""),
        })
    return servers