"""Live room state: who is connected right now.

Saved records (meetings, attendance, speaking) stay in store.py. Nothing here touches the database
except through the callers, so this file has no import of the signaling or host code.
"""
from dataclasses import dataclass, field

from fastapi import WebSocket

from . import store


@dataclass
class Peer:
    id: str
    name: str
    role: str  # "host" or "guest", decided once on the server when the person joins
    ws: WebSocket
    row: int   # this connection's row in the participants table
    cid: str = ""  # browser id, used to keep removed people out
    mic: bool = True
    cam: bool = True
    sharing: bool = False
    can_share: bool = True

    def public(self) -> dict:
        return {"id": self.id, "name": self.name, "role": self.role, "mic": self.mic, "cam": self.cam,
                "sharing": self.sharing, "canShare": self.can_share}


@dataclass
class Room:
    id: str
    peers: dict[str, Peer] = field(default_factory=dict)
    ended: bool = False                         # in memory only: see "known issues"
    banned: set[str] = field(default_factory=set)  # browser ids removed by the host

    async def send(self, peer: Peer, message: dict) -> None:
        try:
            await peer.ws.send_json(message)
        except Exception:
            pass

    async def broadcast(self, message: dict, skip: str | None = None) -> None:
        for p in list(self.peers.values()):
            if p.id != skip:
                await self.send(p, message)

    async def close_peer(self, peer: Peer, code: int, reason: str) -> None:
        try:
            await peer.ws.close(code=code, reason=reason)
        except Exception:
            pass
        await self.drop(peer)

    async def drop(self, peer: Peer) -> None:
        """Take someone out of the room, save their leave time and tell everyone. Safe to call twice."""
        if self.peers.pop(peer.id, None) is not None:
            store.participant_left(peer.row)
            await self.broadcast({"type": "peer-left", "id": peer.id})


rooms: dict[str, Room] = {}


def create_room(room_id: str) -> Room:
    rooms[room_id] = Room(room_id)
    return rooms[room_id]


def get_room(room_id: str) -> Room | None:
    """Meetings are saved in the database, so a link keeps working after a restart."""
    room = rooms.get(room_id)
    if room is None and store.meeting_exists(room_id):
        room = create_room(room_id)
    return room