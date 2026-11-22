"""The WebSocket for one person in one meeting: join, relay connection messages, report state."""
import asyncio
import json
import uuid

from fastapi import WebSocket, WebSocketDisconnect

from . import config, host, store
from .rooms import Peer, get_room


def _flag(msg: dict, key: str, default: bool) -> bool:
    v = msg.get(key)
    return v if isinstance(v, bool) else default


async def room_socket(ws: WebSocket, room_id: str, name: str, token: str, cid: str) -> None:
    room = get_room(room_id)
    await ws.accept()
    cid = cid[:64]
    if not room:
        return await ws.close(code=4404, reason="Meeting not found.")
    if room.ended:
        return await ws.close(code=4410, reason="This meeting has ended.")
    if cid and cid in room.banned:
        return await ws.close(code=4403, reason="You were removed from this meeting.")
    if len(room.peers) >= config.MAX_PEERS:
        return await ws.close(code=4409, reason="Meeting is full.")

    role = "host" if store.is_host(room_id, token) else "guest"
    clean_name = name.strip()[:40] or "Guest"
    peer_id = uuid.uuid4().hex[:8]
    peer = Peer(id=peer_id, name=clean_name, role=role, ws=ws,
                row=store.add_participant(room_id, peer_id, clean_name, role), cid=cid)
    others = [p.public() for p in room.peers.values()]
    room.peers[peer_id] = peer

    await ws.send_json({"type": "welcome", "id": peer_id, "role": role, "me": peer.public(), "peers": others})
    await room.broadcast({"type": "peer-joined", "peer": peer.public()}, skip=peer_id)

    # Background task to keep the connection alive through Cloudflare
    async def heartbeat():
        try:
            while True:
                await asyncio.sleep(20)
                await ws.send_json({"type": "ping"})
        except Exception:
            pass

    ping_task = asyncio.create_task(heartbeat())

    try:
        while True:
            raw = await ws.receive_text()
            if len(raw) > config.MAX_MESSAGE_CHARS:
                await ws.close(code=4413, reason="Message too large.")
                break
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(msg, dict):
                continue
            
            if msg.get("type") == "pong":
                continue # Just a heartbeat reply, ignore.

            store.touch(peer.row)
            kind = msg.get("type")
            if kind == "speaking":
                active = _flag(msg, "active", False)
                store.set_speaking(peer.row, active)
                await room.broadcast({"type": "speaking", "id": peer_id, "active": active}, skip=peer_id)
            elif kind == "state":
                peer.mic = _flag(msg, "mic", peer.mic)
                peer.cam = _flag(msg, "cam", peer.cam)
                peer.sharing = _flag(msg, "sharing", peer.sharing) and peer.can_share
                await room.broadcast({"type": "peer-state", "peer": peer.public()})
            elif kind == "signal":
                to = msg.get("to")
                target = room.peers.get(to) if isinstance(to, str) else None
                if target:
                    await room.send(target, {"type": "signal", "from": peer_id, "data": msg.get("data")})
            elif kind == "host":
                await host.handle(room, peer, msg)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        ping_task.cancel()
        await room.drop(peer)