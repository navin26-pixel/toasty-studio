"""Host-only actions. The role check happens here, on the server, for every single action.

Limit to know: video travels directly between browsers, so the server cannot force someone's microphone
off or stop their screen share. It can (and does) remove people, end the meeting, refuse screen-share
state, and send a mute request that the app obeys.
"""
from .rooms import Peer, Room


async def handle(room: Room, sender: Peer, msg: dict) -> None:
    if sender.role != "host":
        await room.send(sender, {"type": "error", "message": "Only the host can do that."})
        return
    action = msg.get("action")
    if action == "end":
        await end_meeting(room)
        return
    target = room.peers.get(msg.get("target")) if isinstance(msg.get("target"), str) else None
    if target is None or target.role == "host":
        await room.send(sender, {"type": "error", "message": "That participant is not available."})
        return
    if action == "remove":
        if target.cid:
            room.banned.add(target.cid)
        await room.close_peer(target, 4403, "You were removed from this meeting by the host.")
    elif action == "mute":
        await room.send(target, {"type": "mute-request"})
    elif action == "allow-share":
        target.can_share = msg.get("value") is True
        if not target.can_share:
            target.sharing = False
        await room.broadcast({"type": "peer-state", "peer": target.public()})


async def end_meeting(room: Room) -> None:
    room.ended = True
    for p in list(room.peers.values()):
        await room.close_peer(p, 4410, "The host ended the meeting.")