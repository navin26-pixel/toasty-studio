"""Toasty Studio signaling server.

Media flows peer to peer (WebRTC). This server only creates rooms and relays
connection messages between the people in a room. Rooms live in memory.
"""
import json
import os
import secrets
import uuid
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

MAX_PEERS = int(os.getenv("MAX_PEERS", "4"))  # full mesh: keep small
DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"

app = FastAPI(title="Toasty Studio")
rooms: dict[str, dict] = {}  # room_id -> {"host_token": str, "peers": {peer_id: {...}}}


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


@app.get("/api/health")
def health():
    return {"ok": True, "rooms": len(rooms)}


@app.get("/api/config")
def config():
    return {"iceServers": ice_servers(), "maxPeers": MAX_PEERS}


@app.post("/api/rooms")
def create_room():
    room_id = secrets.token_urlsafe(6).replace("_", "x").replace("-", "y")
    host_token = secrets.token_urlsafe(16)
    rooms[room_id] = {"host_token": host_token, "peers": {}}
    return {"roomId": room_id, "hostToken": host_token}


@app.get("/api/rooms/{room_id}")
def room_info(room_id: str):
    room = rooms.get(room_id)
    if not room:
        return JSONResponse({"error": "Meeting not found."}, status_code=404)
    return {"roomId": room_id, "peers": len(room["peers"])}


async def broadcast(room: dict, message: dict, skip: str | None = None):
    for pid, p in list(room["peers"].items()):
        if pid != skip:
            try:
                await p["ws"].send_json(message)
            except Exception:
                pass


@app.websocket("/ws/{room_id}")
async def ws_room(ws: WebSocket, room_id: str, name: str = "Guest", token: str = ""):
    room = rooms.get(room_id)
    await ws.accept()
    if not room:
        await ws.close(code=4404, reason="Meeting not found.")
        return
    if len(room["peers"]) >= MAX_PEERS:
        await ws.close(code=4409, reason="Meeting is full.")
        return

    peer_id = uuid.uuid4().hex[:8]
    role = "host" if token and secrets.compare_digest(token, room["host_token"]) else "guest"
    me = {"id": peer_id, "name": name.strip()[:40] or "Guest", "role": role, "ws": ws}
    others = [{k: p[k] for k in ("id", "name", "role")} for p in room["peers"].values()]
    room["peers"][peer_id] = me

    await ws.send_json({"type": "welcome", "id": peer_id, "role": role, "peers": others})
    await broadcast(room, {"type": "peer-joined", "peer": {"id": peer_id, "name": me["name"], "role": role}}, skip=peer_id)

    try:
        while True:
            msg = json.loads(await ws.receive_text())
            if msg.get("type") == "signal":
                target = room["peers"].get(msg.get("to"))
                if target:
                    await target["ws"].send_json({"type": "signal", "from": peer_id, "data": msg.get("data")})
    except (WebSocketDisconnect, json.JSONDecodeError, RuntimeError):
        pass
    finally:
        room["peers"].pop(peer_id, None)
        await broadcast(room, {"type": "peer-left", "id": peer_id})


if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = DIST / path
        return FileResponse(f if path and f.is_file() else DIST / "index.html")
