import type { Config } from "../services/api";
import { MeetingSocket, type SocketStatus } from "../services/socket";
import { watchSpeaking } from "../media/speaking";
import { buildControls, icon } from "../media/controls";
import { renderPanel, type PeerState } from "../participants/panel";
import { askLeave, hostActions, showReport } from "../host/host";

type Remote = { pc: RTCPeerConnection; queue: Promise<void> };

const $ = (id: string) => document.getElementById(id)!;
const el = (id: string) => document.getElementById(id);

export function startMeeting(roomId: string, name: string, cam: MediaStream, config: Config) {
  const people = new Map<string, PeerState>();
  const remotes = new Map<string, Remote>();
  let myId = "";
  let screen: MediaStream | null = null;
  let speakingNow = false;
  let canShare = true;
  let moreMenu: HTMLElement | null = null;

  const socket = new MeetingSocket(roomId, name, onMessage, onStatus);
  const send = (m: object) => socket.send(m);
  const host = hostActions(send);
  const controls = buildControls($("controls"));
  const isHost = () => people.get(myId)?.role === "host";
  const audio = () => cam.getAudioTracks()[0];
  const video = () => cam.getVideoTracks()[0];

  function setStatus(text: string) { $("status").textContent = text; }
  function announce() { send({ type: "state", mic: audio().enabled, cam: video().enabled, sharing: !!screen }); }

  // ---------- Tiles and panel ----------
  function makeTile(id: string, mine: boolean, stream: MediaStream, label: string) {
    if (el(`tile-${id}`)) return;
    const tile = document.createElement("div");
    tile.className = "tile" + (mine ? " mine" : "");
    tile.id = `tile-${id}`;
    const v = document.createElement("video");
    v.autoplay = true; v.playsInline = true; v.muted = mine; v.srcObject = stream;
    const nm = document.createElement("span");
    nm.className = "name"; nm.textContent = label;
    const badge = document.createElement("span");
    badge.className = "badge-mic"; badge.innerHTML = icon.micOff;
    tile.append(v, nm, badge);
    $("grid").append(tile);
  }

  function paintTile(p: PeerState) {
    const tile = el(p.id === myId ? "tile-me" : `tile-${p.id}`);
    if (!tile) return;
    tile.querySelector(".name")!.textContent = `${p.name}${p.id === myId ? " (you)" : ""}${p.role === "host" ? " \u00b7 host" : ""}`;
    tile.classList.toggle("muted", !p.mic);
    tile.classList.toggle("camoff", !p.cam);
    tile.classList.toggle("sharing", p.sharing);
    tile.dataset.initial = (p.name[0] ?? "?").toUpperCase();
  }

  function refresh() {
    for (const p of people.values()) paintTile(p);
    renderPanel($("panel"), [...people.values()], myId, isHost() ? host : null);
  }

  // ---------- More menu ----------
  function openPeople() { refresh(); $("panel").hidden = false; }

  function copyLink() {
    void navigator.clipboard.writeText(`${location.origin}/r/${roomId}`).then(
      () => setStatus("Link copied."),
      () => setStatus("Could not copy. Copy the URL from the address bar."),
    );
  }

  function openSettings() {
    setStatus("Meeting settings are not yet available in this build.");
  }

  function menuItem(label: string, onClick: () => void, danger = false): HTMLElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "more-item" + (danger ? " danger" : "");
    b.setAttribute("role", "menuitem");
    b.textContent = label;
    b.onclick = () => { closeMoreMenu(); onClick(); };
    return b;
  }

  function divider(): HTMLElement {
    const d = document.createElement("div");
    d.className = "more-divider";
    return d;
  }

  function toggleMoreMenu() {
    if (moreMenu) closeMoreMenu();
    else openMoreMenu();
  }

  function openMoreMenu() {
    const btn = controls.more;
    const rect = btn.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.className = "more-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "More actions");
    menu.style.position = "fixed";
    menu.style.bottom = `${window.innerHeight - rect.top + 8}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;

    if (isHost()) {
      menu.append(
        menuItem("Copy meeting link", copyLink),
        menuItem("Toggle camera", () => setCam(!video().enabled)),
        menuItem("Mute a participant…", openPeople),
        menuItem("Remove a participant…", openPeople),
        menuItem("Screen sharing permissions…", openPeople),
        menuItem("Speaker report", () => { void showReport(roomId).then((ok) => { if (!ok) setStatus("Only the host can open the report."); }); }),
        menuItem("Meeting settings", openSettings),
        divider(),
        menuItem("End meeting for everyone", () => {
          if (confirm("End the meeting for everyone?")) host.end();
        }, true),
      );
    } else {
      menu.append(
        menuItem("Toggle camera", () => setCam(!video().enabled)),
      );
    }

    document.body.append(menu);
    moreMenu = menu;
    controls.more.setAttribute("aria-expanded", "true");
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onEsc);
  }

  function closeMoreMenu() {
    if (!moreMenu) return;
    moreMenu.remove();
    moreMenu = null;
    controls.more.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onEsc);
  }

  function onDocClick(e: MouseEvent) {
    if (moreMenu && !moreMenu.contains(e.target as Node)) closeMoreMenu();
  }

  function onEsc(e: KeyboardEvent) {
    if (e.key === "Escape") closeMoreMenu();
  }

  // ---------- Messages from the server ----------
  function onMessage(m: any) {
    switch (m.type) {
      case "welcome": {
        myId = m.id;
        people.clear();
        people.set(m.id, m.me);
        canShare = m.me.canShare;
        for (const p of m.peers as PeerState[]) {
          people.set(p.id, p);
          makeTile(p.id, false, new MediaStream(), p.name);
          createPeer(p, true);
        }
        announce();
        if (speakingNow) send({ type: "speaking", active: true });
        setStatus(m.peers.length ? "" : "Waiting for others. Copy the link from the address bar and send it.");
        refresh();
        break;
      }
      case "peer-joined":
        people.set(m.peer.id, m.peer);
        makeTile(m.peer.id, false, new MediaStream(), m.peer.name);
        createPeer(m.peer, false);
        setStatus("");
        refresh();
        break;
      case "peer-left":
        removeRemote(m.id);
        people.delete(m.id);
        if (people.size <= 1) setStatus("Everyone else left. You can wait here or leave.");
        refresh();
        break;
      case "peer-state": {
        const p = m.peer as PeerState;
        people.set(p.id, p);
        if (p.id === myId) {
          canShare = p.canShare;
          if (!p.canShare && screen) void stopShare();
          controls.setShare(!!screen, canShare);
        }
        refresh();
        break;
      }
      case "speaking":
        el(`tile-${m.id}`)?.classList.toggle("speaking", m.active === true);
        break;
      case "signal": {
        const r = remotes.get(m.from);
        if (r) r.queue = r.queue.then(() => onSignal(m.from, r, m.data)).catch(console.error);
        break;
      }
      case "mute-request":
        setMic(false);
        setStatus("The host asked you to mute.");
        break;
      case "error":
        setStatus(m.message);
        break;
    }
  }

  function onStatus(s: SocketStatus, reason?: string) {
    const label = { online: "Connected", reconnecting: "Reconnecting...", closed: "Disconnected" }[s];
    $("conn").dataset.state = s;
    $("conn").textContent = label;
    if (s === "reconnecting") {
      resetRemotes();
      setStatus("Connection lost. Trying to reconnect...");
    } else if (s === "closed") {
      finish(reason || "You were disconnected from this meeting.");
    }
  }

  // ---------- WebRTC ----------
  function createPeer(p: PeerState, offer: boolean) {
    if (remotes.has(p.id)) return;
    const pc = new RTCPeerConnection({ iceServers: config.iceServers });
    remotes.set(p.id, { pc, queue: Promise.resolve() });
    for (const t of cam.getAudioTracks()) pc.addTrack(t, cam);
    pc.addTrack((screen ?? cam).getVideoTracks()[0], cam);
    pc.onicecandidate = (e) => e.candidate && send({ type: "signal", to: p.id, data: { candidate: e.candidate } });
    pc.ontrack = (e) => {
      const v = el(`tile-${p.id}`)?.querySelector("video");
      if (!v) return;
      const stream = (v.srcObject as MediaStream) ?? new MediaStream();
      if (!stream.getTracks().includes(e.track)) stream.addTrack(e.track);
      v.srcObject = stream;
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") pc.restartIce(); };
    if (offer) {
      pc.onnegotiationneeded = async () => {
        await pc.setLocalDescription(await pc.createOffer());
        send({ type: "signal", to: p.id, data: { sdp: pc.localDescription } });
      };
    }
  }

  async function onSignal(from: string, r: Remote, data: any) {
    const pc = r.pc;
    if (data?.sdp) {
      await pc.setRemoteDescription(data.sdp);
      if (data.sdp.type === "offer") {
        await pc.setLocalDescription(await pc.createAnswer());
        send({ type: "signal", to: from, data: { sdp: pc.localDescription } });
      }
    } else if (data?.candidate) {
      await pc.addIceCandidate(data.candidate).catch(() => {});
    }
  }

  function removeRemote(id: string) {
    remotes.get(id)?.pc.close();
    remotes.delete(id);
    el(`tile-${id}`)?.remove();
  }

  function resetRemotes() {
    for (const id of [...remotes.keys()]) removeRemote(id);
    for (const id of [...people.keys()]) if (id !== myId) people.delete(id);
    refresh();
  }

  // ---------- Local media ----------
  function setMic(on: boolean) { audio().enabled = on; controls.setMic(on); announce(); }
  function setCam(on: boolean) { video().enabled = on; announce(); }

  async function swapVideo(track: MediaStreamTrack) {
    for (const { pc } of remotes.values()) {
      await pc.getSenders().find((s) => s.track?.kind === "video")?.replaceTrack(track);
    }
    (el("tile-me")!.querySelector("video") as HTMLVideoElement).srcObject = new MediaStream([track]);
  }

  async function startShare() {
    if (!canShare) return setStatus("The host turned off screen sharing for you.");
    try {
      screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
    } catch { return; }
    const track = screen.getVideoTracks()[0];
    track.onended = () => void stopShare();
    await swapVideo(track);
    controls.setShare(true, canShare);
    announce();
  }

  async function stopShare() {
    if (!screen) return;
    screen.getTracks().forEach((t) => t.stop());
    screen = null;
    await swapVideo(video());
    controls.setShare(false, canShare);
    announce();
  }

  // ---------- Leaving and closing ----------
  function cleanup() {
    stopSpeaking();
    cam.getTracks().forEach((t) => t.stop());
    screen?.getTracks().forEach((t) => t.stop());
    resetRemotes();
  }

  function finish(reason: string) {
    cleanup();
    $("room").hidden = true;
    $("endedText").textContent = reason;
    $("ended").hidden = false;
  }

  function leave() {
    socket.close();
    cleanup();
    location.href = `/r/${roomId}`;
  }

  // ---------- Wire it up ----------
  makeTile("me", true, cam, `${name} (you)`);
  controls.setMic(audio().enabled);
  controls.setShare(false, true);
  controls.mic.onclick = () => setMic(!audio().enabled);
  controls.share.onclick = () => (screen ? void stopShare() : void startShare());
  controls.people.onclick = () => { refresh(); $("panel").hidden = !$("panel").hidden; };
  controls.more.onclick = (e) => { e.stopPropagation(); toggleMoreMenu(); };
  controls.leave.onclick = async () => {
    if (isHost()) {
      const choice = await askLeave();
      if (choice === "cancel") return;
      if (choice === "end") return host.end();
    }
    leave();
  };

  const stopSpeaking = watchSpeaking(cam, (active) => {
    speakingNow = active;
    send({ type: "speaking", active });
    el("tile-me")?.classList.toggle("speaking", active);
  });
  socket.connect();
}