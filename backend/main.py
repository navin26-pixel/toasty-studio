"""Toasty Studio server: routes and wiring only.

rooms.py: who is connected now   host.py: host-only actions   signaling.py: the WebSocket
store.py: saved records          config.py: settings
Run from the project folder:  uvicorn backend.main:app --port 8000
"""
import asyncio
import secrets
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config, rooms, signaling, store


@asynccontextmanager
async def lifespan(_app):
    async def periodic_backup():
        while True:
            await asyncio.sleep(config.BACKUP_EVERY_SECONDS)
            await asyncio.to_thread(store.backup)
    task = asyncio.create_task(periodic_backup())
    yield
    task.cancel()


app = FastAPI(title="Toasty Studio", lifespan=lifespan)
store.init()


@app.get("/api/health")
def health():
    return {"ok": True, "rooms": len(rooms.rooms)}


@app.get("/api/config")
def get_config():
    return {"iceServers": config.ice_servers(), "maxPeers": config.MAX_PEERS}


@app.post("/api/rooms")
def create_room():
    room_id = secrets.token_urlsafe(6).replace("_", "x").replace("-", "y")
    host_token = secrets.token_urlsafe(16)
    store.create_meeting(room_id, host_token)
    rooms.create_room(room_id)
    return {"roomId": room_id, "hostToken": host_token}


@app.get("/api/rooms/{room_id}")
def room_info(room_id: str):
    room = rooms.get_room(room_id)
    if not room:
        return JSONResponse({"error": "Meeting not found."}, status_code=404)
    if room.ended:
        return JSONResponse({"error": "This meeting has ended."}, status_code=410)
    return {"roomId": room_id, "peers": len(room.peers)}


@app.get("/api/rooms/{room_id}/report")
def room_report(room_id: str, token: str = ""):
    if not store.is_host(room_id, token):
        return JSONResponse({"error": "Only the host can view the report."}, status_code=403)
    return store.report(room_id)


@app.websocket("/ws/{room_id}")
async def ws_room(ws: WebSocket, room_id: str, name: str = "Guest", token: str = "", cid: str = ""):
    await signaling.room_socket(ws, room_id, name, token, cid)


if config.DIST.exists():
    app.mount("/assets", StaticFiles(directory=config.DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = (config.DIST / path).resolve()
        inside = config.DIST.resolve() in f.parents
        return FileResponse(f if path and inside and f.is_file() else config.DIST / "index.html")