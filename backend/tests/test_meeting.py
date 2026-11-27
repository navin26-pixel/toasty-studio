"""Host permissions and meeting lifecycle. Run from the project folder:  python -m pytest backend/tests -q"""
import os
import tempfile

os.environ["STUDIO_DB"] = os.path.join(tempfile.mkdtemp(), "test.db")

import pytest
from fastapi.testclient import TestClient  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402

from backend import config  # noqa: E402
from backend.main import app  # noqa: E402

client = TestClient(app)


def new_meeting():
    r = client.post("/api/rooms").json()
    return r["roomId"], r["hostToken"]


def url(room, name="Guest", token="", cid=""):
    return f"/ws/{room}?name={name}&token={token}&cid={cid}"


def until(ws, kind, limit=12):
    for _ in range(limit):
        m = ws.receive_json()
        if m["type"] == kind:
            return m
    raise AssertionError(f"never received {kind}")


def until_peer(ws, limit=12, **want):
    """Wait for a peer-state message whose fields match, skipping older queued ones."""
    for _ in range(limit):
        m = ws.receive_json()
        if m["type"] == "peer-state" and all(m["peer"].get(k) == v for k, v in want.items()):
            return m["peer"]
    raise AssertionError(f"never saw peer-state {want}")


def closed_with(ws):
    with pytest.raises(WebSocketDisconnect) as e:
        for _ in range(12):
            ws.receive_json()
    return e.value.code


def join_pair(room, token, guest_cid="g1"):
    h = client.websocket_connect(url(room, "Shaan", token, "h1"))
    host = h.__enter__()
    hw = host.receive_json()
    g = client.websocket_connect(url(room, "Ricardo", "", guest_cid))
    guest = g.__enter__()
    gw = guest.receive_json()
    until(host, "peer-joined")
    return (h, host, hw), (g, guest, gw)


def test_roles_and_welcome():
    room, tok = new_meeting()
    (h, host, hw), (g, guest, gw) = join_pair(room, tok)
    assert hw["role"] == "host" and gw["role"] == "guest"
    assert gw["peers"][0]["role"] == "host" and gw["me"]["canShare"] is True
    g.__exit__(None, None, None); h.__exit__(None, None, None)


def test_guest_cannot_run_host_actions():
    room, tok = new_meeting()
    (h, host, hw), (g, guest, gw) = join_pair(room, tok)
    for action in ("end", "remove", "mute", "allow-share"):
        guest.send_json({"type": "host", "action": action, "target": hw["id"], "value": False})
        assert until(guest, "error")["message"] == "Only the host can do that."
    assert client.get(f"/api/rooms/{room}").status_code == 200   # meeting not ended
    host.send_json({"type": "state", "mic": False})
    assert until(guest, "peer-state")["peer"]["mic"] is False     # host still connected and working
    g.__exit__(None, None, None); h.__exit__(None, None, None)


def test_state_is_shared_with_everyone():
    room, tok = new_meeting()
    (h, host, hw), (g, guest, gw) = join_pair(room, tok)
    guest.send_json({"type": "state", "mic": False, "cam": False})
    seen = until(host, "peer-state")["peer"]
    assert seen["id"] == gw["id"] and seen["mic"] is False and seen["cam"] is False
    until(guest, "peer-state")  # the sender sees its own confirmed state too
    g.__exit__(None, None, None); h.__exit__(None, None, None)


def test_mute_request_reaches_only_the_target():
    room, tok = new_meeting()
    (h, host, hw), (g, guest, gw) = join_pair(room, tok)
    host.send_json({"type": "host", "action": "mute", "target": gw["id"]})
    assert until(guest, "mute-request")
    g.__exit__(None, None, None); h.__exit__(None, None, None)


def test_remove_participant_and_keep_them_out():
    room, tok = new_meeting()
    (h, host, hw), (g, guest, gw) = join_pair(room, tok, guest_cid="removeme")
    host.send_json({"type": "host", "action": "remove", "target": gw["id"]})
    assert closed_with(guest) == 4403
    assert until(host, "peer-left")["id"] == gw["id"]
    with client.websocket_connect(url(room, "Ricardo", "", "removeme")) as again:
        assert closed_with(again) == 4403                      # same browser is refused
    with client.websocket_connect(url(room, "Ricardo", "", "other-browser")) as fresh:
        assert fresh.receive_json()["role"] == "guest"         # a different browser can still join
    h.__exit__(None, None, None)


def test_host_cannot_be_removed_or_targeted_wrongly():
    room, tok = new_meeting()
    (h, host, hw), (g, guest, gw) = join_pair(room, tok)
    host.send_json({"type": "host", "action": "remove", "target": hw["id"]})
    assert until(host, "error")
    host.send_json({"type": "host", "action": "remove", "target": "nobody"})
    assert until(host, "error")
    g.__exit__(None, None, None); h.__exit__(None, None, None)


def test_screen_share_permission():
    room, tok = new_meeting()
    (h, host, hw), (g, guest, gw) = join_pair(room, tok)
    host.send_json({"type": "host", "action": "allow-share", "target": gw["id"], "value": False})
    assert until_peer(guest, canShare=False)
    guest.send_json({"type": "state", "sharing": True})
    refused = until_peer(guest, canShare=False)
    assert refused["sharing"] is False                                 # server refuses the share state
    host.send_json({"type": "host", "action": "allow-share", "target": gw["id"], "value": True})
    until_peer(guest, canShare=True)
    guest.send_json({"type": "state", "sharing": True})
    assert until_peer(host, sharing=True, canShare=True)
    g.__exit__(None, None, None); h.__exit__(None, None, None)


def test_end_meeting_for_everyone():
    room, tok = new_meeting()
    (h, host, hw), (g, guest, gw) = join_pair(room, tok)
    host.send_json({"type": "host", "action": "end"})
    assert closed_with(guest) == 4410
    assert closed_with(host) == 4410
    assert client.get(f"/api/rooms/{room}").status_code == 410
    with client.websocket_connect(url(room, "Late", tok, "x")) as late:
        assert closed_with(late) == 4410                        # not even the host can rejoin
    assert client.get(f"/api/rooms/{room}/report", params={"token": tok}).status_code == 200  # records kept


def test_report_is_host_only():
    room, tok = new_meeting()
    assert client.get(f"/api/rooms/{room}/report").status_code == 403
    assert client.get(f"/api/rooms/{room}/report", params={"token": "bad"}).status_code == 403
    assert client.get(f"/api/rooms/{room}/report", params={"token": tok}).status_code == 200


def test_bad_input_does_not_break_the_connection():
    room, tok = new_meeting()
    with client.websocket_connect(url(room, "A", tok, "a")) as ws:
        ws.receive_json()
        for junk in ("[1,2]", "5", "hello", '{"type":"signal","to":["x"]}', '{"type":"state","mic":"no"}'):
            ws.send_text(junk)
        ws.send_json({"type": "state", "mic": False})
        assert until_peer(ws, mic=False)


def test_oversized_message_is_refused():
    room, tok = new_meeting()
    with client.websocket_connect(url(room, "A", tok, "a")) as ws:
        ws.receive_json()
        ws.send_text("x" * 70_000)
        assert closed_with(ws) == 4413


def test_meeting_is_full_and_unknown_meeting():
    room, tok = new_meeting()
    n = config.MAX_PEERS  # honours the live cap, whatever it is
    socks = [client.websocket_connect(url(room, f"p{i}", "", f"c{i}")) for i in range(n)]
    opened = [s.__enter__() for s in socks]
    for o in opened:
        o.receive_json()
    with client.websocket_connect(url(room, "late")) as late:
        assert closed_with(late) == 4409
    for s in socks:
        s.__exit__(None, None, None)
    with client.websocket_connect(url("nope")) as missing:
        assert closed_with(missing) == 4404


def test_attendance_and_speaking_are_saved():
    room, tok = new_meeting()
    with client.websocket_connect(url(room, "Shaan", tok, "a")) as ws:
        ws.receive_json()
        ws.send_json({"type": "speaking", "active": True})
        ws.send_json({"type": "speaking", "active": False})
        ws.send_json({"type": "state", "mic": True})
        until(ws, "peer-state")
    rep = client.get(f"/api/rooms/{room}/report", params={"token": tok}).json()
    assert rep["participants"][0]["name"] == "Shaan" and rep["participants"][0]["leftAt"]
    assert rep["speakers"][0]["turns"] == 1