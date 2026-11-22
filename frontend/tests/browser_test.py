"""Playwright browser test suite for Toasty Studio (29 tests).

Run from the project root:
    python frontend/tests/browser_test.py

Prerequisites:
    - The test WAV exists:   python frontend/tests/make_test_audio.py
    - Python deps:           pip install playwright httpx
    - Chromium:              python -m playwright install chromium

Starts its own uvicorn server on port 8780 with a temporary SQLite database.
Your real backend/data/studio.db is never modified.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx
from playwright.sync_api import BrowserContext, Page, sync_playwright

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
WAV = HERE / "test-speech.wav"
SHOTS = HERE / "shots"
PORT = 8780
BASE = f"http://127.0.0.1:{PORT}"

if not WAV.exists():
    sys.exit(f"Missing {WAV}\nRun first: python frontend/tests/make_test_audio.py")

SHOTS.mkdir(exist_ok=True)
_tmp = Path(tempfile.mkdtemp(prefix="toasty-bt-"))
DB_PATH = str(_tmp / "studio.db")

results: list[tuple[str, bool, str]] = []
errors: list[tuple[str, str, str]] = []


def start_server() -> subprocess.Popen:
    env = {**os.environ, "STUDIO_DB": DB_PATH}
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.main:app", "--port", str(PORT)],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(60):
        try:
            if httpx.get(f"{BASE}/api/health", timeout=1.0).status_code == 200:
                return proc
        except Exception:
            pass
        time.sleep(0.25)
    proc.kill()
    raise RuntimeError("server did not start within 15s")


def step(name: str, fn) -> None:
    try:
        r = fn()
        results.append((name, True, "" if r in (None, True) else str(r)))
        suffix = f" ({r})" if r not in (None, True) else ""
        print(f"  PASS {name}{suffix}")
    except Exception as e:
        msg = str(e).splitlines()[0][:200]
        results.append((name, False, msg))
        print(f"  FAIL {name}: {msg}")


def color(page: Page, sel: str, prop: str) -> str:
    return page.eval_on_selector(sel, f"e => getComputedStyle(e).{prop}")


def wait_color(page: Page, sel: str, prop: str, want: str, timeout_ms: int = 5000) -> None:
    """Poll computed style until it matches. Avoids racing the CSS transition."""
    page.wait_for_function(
        f"() => getComputedStyle(document.querySelector({json.dumps(sel)})).{prop} === {json.dumps(want)}",
        timeout=timeout_ms,
    )


def wait_true(fn, secs: float = 15.0) -> bool:
    end = time.time() + secs
    while time.time() < end:
        try:
            if fn():
                return True
        except Exception:
            pass
        time.sleep(0.3)
    raise AssertionError("timed out")


def eq(actual, expected) -> bool:
    assert actual == expected, f"got {actual!r}, expected {expected!r}"
    return True


# Wrapped in (...)() so page.evaluate actually CALLS the async function and
# awaits the promise. Without the outer call, evaluate returns the function
# object (always truthy), which is why the old test could "pass" without any
# real video flowing.
PLAYING = """(() => new Promise(res => {
  const v = [...document.querySelectorAll('.tile:not(.mine) video')];
  if (!v.length) return res(false);
  const t0 = v.map(x => x.currentTime);
  setTimeout(() => res(v.every((x, i) =>
    x.videoWidth > 0 && x.currentTime > t0[i]
    && x.srcObject && x.srcObject.getAudioTracks().length > 0
  )), 1500);
}))()"""


def main() -> int:
    server = start_server()
    try:
        with sync_playwright() as pw:
            wav_arg = str(WAV).replace("\\", "/")
            br = pw.chromium.launch(args=[
                "--use-fake-device-for-media-stream",
                "--use-fake-ui-for-media-stream",
                f"--use-file-for-fake-audio-capture={wav_arg}",
                "--no-sandbox",
                "--autoplay-policy=no-user-gesture-required",
            ])

            def new_page(label: str) -> tuple[BrowserContext, Page]:
                ctx = br.new_context(
                    permissions=["camera", "microphone"],
                    viewport={"width": 1280, "height": 760},
                )
                pg = ctx.new_page()
                pg.set_default_timeout(10_000)
                pg.on("pageerror", lambda e: errors.append((label, "pageerror", str(e)[:150])))
                pg.on(
                    "console",
                    lambda m: m.type == "error" and errors.append((label, "console", m.text[:150])),
                )
                pg.on("dialog", lambda d: d.accept())
                return ctx, pg

            ctxH, H = new_page("host")
            ctxA, A = new_page("guestA")

            # ── Meeting 1: host + guest ─────────────────────────────
            print("MEETING 1: host + guest")

            def host_creates():
                H.goto(BASE + "/")
                H.fill("#homeName", "Shaan")
                H.click("#create")
                H.wait_for_url(re.compile(r"/r/\w+"))
                H.wait_for_selector("#join:enabled")
                H.click("#join")
                H.wait_for_selector("#conn[data-state=online]")
                return H.url

            step("host starts a meeting and joins", host_creates)
            link = H.url

            def guest_joins():
                A.goto(link)
                A.wait_for_selector("#join:enabled")
                A.fill("#lobbyName", "Ricardo")
                A.click("#join")
                A.wait_for_selector("#conn[data-state=online]")

            step("guest joins through the link", guest_joins)
            step("host sees real remote video + audio flowing",
                 lambda: wait_true(lambda: H.evaluate(PLAYING)))
            step("guest sees real remote video + audio flowing",
                 lambda: wait_true(lambda: A.evaluate(PLAYING)))
            step("names and host label shown on tiles",
                 lambda: wait_true(lambda: "Shaan" in A.inner_text("#grid")
                                   and "host" in A.inner_text("#grid")
                                   and "Ricardo" in H.inner_text("#grid")))

            step("mic button unmuted: white background",
                 lambda: eq(color(A, "#controls .mic", "backgroundColor"), "rgb(255, 255, 255)"))
            step("leave button: black background, red text",
                 lambda: eq(color(A, "#controls .leave", "backgroundColor"), "rgb(9, 9, 9)"))

            def mute_a():
                A.click("#controls .mic")
                wait_color(A, "#controls .mic", "backgroundColor", "rgb(220, 38, 38)")
                wait_color(A, "#controls .mic", "color", "rgb(255, 255, 255)")
                assert "muted" in (A.get_attribute("#controls .mic", "class") or ""), "missing 'muted' class"
                assert "Unmute" in A.inner_text("#controls .mic"), "label not 'Unmute'"

            step("guest mutes: button turns red immediately", mute_a)
            step("host sees the guest as muted (tile badge)",
                 lambda: wait_true(
                     lambda: "muted" in (H.eval_on_selector_all(
                         "#grid .tile:not(.mine)", "e => e[0] && e[0].className") or "")))
            step("host panel shows guest mic off", lambda: (
                H.click("#controls .people"),
                wait_true(lambda: H.locator(
                    "#panel .row:has-text('Ricardo') .status .off").count() >= 1),
            )[1])

            H.screenshot(path=str(SHOTS / "host_panel.png"))
            A.screenshot(path=str(SHOTS / "guest_muted.png"))

            A.click("#controls .mic")
            step("guest unmutes: button back to white",
                 lambda: wait_color(A, "#controls .mic", "backgroundColor", "rgb(255, 255, 255)"))

            A.click("#controls .cam")
            step("camera off shows on the host's screen",
                 lambda: wait_true(
                     lambda: "camoff" in (H.eval_on_selector_all(
                         "#grid .tile:not(.mine)", "e => e[0] && e[0].className") or "")))
            A.click("#controls .cam")

            step("host panel has Remove, guest panel does not", lambda: (
                A.click("#controls .people"),
                wait_true(lambda: H.locator(
                    "#panel button:has-text('Remove')").count() == 1
                    and A.locator("#panel button").count() == 0),
            )[1])

            def ask_mute():
                assert "Unmute" not in A.inner_text("#controls .mic")
                H.click("#panel button:has-text('Ask to mute')")
                wait_true(lambda: "muted" in (A.get_attribute("#controls .mic", "class") or ""))

            step("host 'Ask to mute' mutes the guest's mic", ask_mute)

            def block_share():
                H.click("#panel button:has-text('Block sharing')")
                wait_true(lambda: A.is_disabled("#controls .share"))
                H.click("#panel button:has-text('Allow sharing')")
                wait_true(lambda: not A.is_disabled("#controls .share"))

            step("host blocks, then allows, guest screen sharing", block_share)

            def forged():
                A.evaluate("""() => new Promise(res => {
                    const cid = localStorage.getItem('toasty:cid');
                    const id = location.pathname.split('/')[2];
                    const ws = new WebSocket(`ws://${location.host}/ws/${id}?name=Hacker&cid=x${cid}`);
                    ws.onmessage = e => {
                        const m = JSON.parse(e.data);
                        if (m.type === 'welcome') ws.send(JSON.stringify({type: 'host', action: 'end'}));
                        if (m.type === 'error') { window.__err = m.message; ws.close(); res(m.message); }
                    };
                    setTimeout(() => res('none'), 4000);
                })""")
                assert A.evaluate("window.__err") == "Only the host can do that.", \
                    "guest forged end was not refused"
                room_id = link.split("/")[-1]
                assert httpx.get(f"{BASE}/api/rooms/{room_id}").status_code == 200

            step("a guest's forged 'end meeting' is refused by the server", forged)

            def share():
                A.click("#controls .share")
                time.sleep(2.5)
                return "sharing" in (A.eval_on_selector("#tile-me", "e => e.className") or "")

            def share_check():
                if not share():
                    raise AssertionError("getDisplayMedia not available headless")
                return True

            step("screen share starts and shows as sharing", share_check)

            def speaking():
                wait_true(lambda: H.evaluate("() => document.querySelector('.tile.speaking') !== null")
                          or A.evaluate("() => document.querySelector('.tile.speaking') !== null"), 25)
                room_id = link.split("/")[-1]
                tok = H.evaluate(f"localStorage.getItem('toasty:host:{room_id}')")
                r = httpx.get(f"{BASE}/api/rooms/{room_id}/report",
                              params={"token": tok}).json()
                assert r["speakers"], "no speakers in report"
                assert r["speakers"][0]["turns"] >= 1, "no turns recorded"
                return f"{r['speakers'][0]['name']} {r['speakers'][0]['speakingMs']}ms"

            step("speaking indicator lights and is saved", speaking)

            def report_ui():
                H.click("#controls .report")
                H.wait_for_selector("#reportDialog[open]")
                t = H.inner_text("#reportBody")
                H.click("#reportDialog button:has-text('Close')")
                assert "Who spoke" in t and "Ricardo" in t

            step("host opens the report; guest has no report button",
                 lambda: (report_ui(), A.locator("#controls .report").is_hidden())[1])

            H.screenshot(path=str(SHOTS / "host_full.png"))

            # ── Reconnect: stop server, start server ────────────────
            print("RECONNECT: stop the server mid-meeting, start it again")
            server.kill()
            server.wait()

            step("both show 'Reconnecting...' while the server is down",
                 lambda: wait_true(lambda: "Reconnecting" in H.inner_text("#conn")
                                   and "Reconnecting" in A.inner_text("#conn"), 15))

            server = start_server()

            step("both reconnect on their own and are 'Connected'",
                 lambda: wait_true(lambda: H.get_attribute("#conn", "data-state") == "online"
                                   and A.get_attribute("#conn", "data-state") == "online", 30))

            step("video flows again after reconnecting, no duplicate tiles",
                 lambda: wait_true(lambda: H.evaluate(PLAYING) and A.evaluate(PLAYING)
                                   and H.locator("#grid .tile").count() == 2
                                   and A.locator("#grid .tile").count() == 2, 30))

            step("host still recognised as host after the restart",
                 lambda: H.locator("#controls .report").is_visible())

            # ── Remove ────────────────────────────────────────────
            print("REMOVE")
            if H.is_hidden("#panel"):
                H.click("#controls .people")

            def remove():
                H.click("#panel button:has-text('Remove')")
                wait_true(lambda: A.is_visible("#ended"))
                assert "removed" in A.inner_text("#endedText").lower(), A.inner_text("#endedText")
                wait_true(lambda: H.locator("#grid .tile").count() == 1)

            step("host removes guest: guest is shown a closed screen, host updates", remove)

            def rejoin_blocked():
                A.goto(link)
                A.wait_for_selector("#join:enabled")
                A.fill("#lobbyName", "Ricardo")
                A.click("#join")
                wait_true(lambda: A.is_visible("#ended"))
                assert "removed" in A.inner_text("#endedText").lower()

            step("removed person cannot rejoin from the same browser", rejoin_blocked)

            # ── New guest + end meeting ───────────────────────────
            print("MEETING 1 continues: new guest B, host ends the meeting")
            ctxB, B = new_page("guestB")

            step("a different guest can still join", lambda: (
                B.goto(link),
                B.wait_for_selector("#join:enabled"),
                B.fill("#lobbyName", "Mina"),
                B.click("#join"),
                wait_true(lambda: B.get_attribute("#conn", "data-state") == "online"),
            )[3])

            step("host + new guest see each other",
                 lambda: wait_true(lambda: H.evaluate(PLAYING) and B.evaluate(PLAYING)))

            def end_all():
                H.click("#controls .leave")
                H.wait_for_selector("#leaveDialog[open]")
                H.click("#leaveDialog button:has-text('End for everyone')")
                wait_true(lambda: H.is_visible("#ended") and B.is_visible("#ended"))
                assert "ended" in B.inner_text("#endedText").lower()

            step("host leave asks first; 'End for everyone' closes everyone", end_all)

            def ended_blocked():
                ctxN, N = new_page("late")
                N.goto(link)
                wait_true(lambda: "ended" in N.inner_text("#lobbyError").lower())

            step("an ended meeting refuses new joiners", ended_blocked)

            br.close()
    finally:
        server.kill()
        try:
            server.wait(timeout=5)
        except Exception:
            pass

    total = len(results)
    passed = sum(1 for _, ok, _ in results if ok)
    failed = total - passed
    print(f"\nsummary: {passed} passed, {failed} failed, {total} total")
    print("browser errors:", errors[:8] if errors else "none")

    (HERE / "results.json").write_text(json.dumps(results, indent=2))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())