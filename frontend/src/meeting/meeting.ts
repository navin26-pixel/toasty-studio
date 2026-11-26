import type { Config } from "../services/api";
import { MeetingSocket, type SocketStatus } from "../services/socket";
import { watchSpeaking } from "../media/speaking";
import { buildControls, icon } from "../media/controls";
import type { PanelActions, PeerState } from "../participants/panel";
import { askLeave, hostActions, showReport } from "../host/host";
import { parseRole, ROLE_LABEL, type Role } from "../roles/roles";
import { MAX_CHAT, unwrap, wrap, type Relay } from "../roles/relay";
import { confirmDialog } from "../ui/dialog";
import { toast } from "../ui/toast";
import { createWorkspace } from "../producer/workspace";
import { createViewMenu, type View } from "../producer/view-switch";
import { openAssignDialog } from "../producer/assign-dialog";
import { createMoxiePanel } from "../moxie/panel";
import { createSettings } from "../settings/settings";

type Remote = { pc: RTCPeerConnection; queue: Promise<void> };
type Dock = "people" | "moxie" | null;
type Sinkable = HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };

const $ = (id: string) => document.getElementById(id)!;
const el = (id: string) => document.getElementById(id);

export function startMeeting(roomId: string, name: string, cam: MediaStream, config: Config) {
  const people = new Map<string, PeerState>();
  const remotes = new Map<string, Remote>();
  const speaking = new Set<string>();
  /** Ids the host has made producers. Only ever replaced by a message from the host. */
  const producers = new Set<string>();
  let myId = "";
  let screen: MediaStream | null = null;
  let speakingNow = false;
  let canShare = true;
  let moreMenu: HTMLElement | null = null;
  let view: View = "host";
  let closed = false;
  let dock: Dock = null;
  let speakerId = "";
  let socketState: SocketStatus = "reconnecting";
  let stopSpeaking: () => void = () => {};
  const startedAt = Date.now();

  const socket = new MeetingSocket(roomId, name, onMessage, onStatus);
  const send = (m: object) => socket.send(m);
  const host = hostActions(send);
  const controls = buildControls($("controls"));
  /** Real authority comes from the server's role. Only the host has it. */
  const isHost = () => parseRole(people.get(myId)?.role) === "host";
  const roleOf = (id: string): Role => (parseRole(people.get(id)?.role) === "host" ? "host" : producers.has(id) ? "producer" : "guest");
  const myRole = () => roleOf(myId);
  const mode = () => (myRole() === "host" ? view : myRole());
  const audio = () => cam.getAudioTracks()[0];
  const video = () => cam.getVideoTracks()[0];
  const inviteUrl = () => `${location.origin}/r/${roomId}`;

  const workspace = createWorkspace($("panel"), { roomId, startedAt, onChat: sendChat });
  $("panel").classList.add("workspace");

  function setStatus(text: string) { $("status").textContent = text; }
  function announce() { send({ type: "state", mic: audio().enabled, cam: video().enabled, sharing: !!screen }); }

  // Messages between people, carried by the existing signal relay
  function relay(to: string, m: Relay) { send({ type: "signal", to, data: wrap(m) }); }
  function relayAll(m: Relay) { for (const id of people.keys()) if (id !== myId) relay(id, m); }
  function shareProducers(to?: string) {
    if (!isHost()) return;
    const m: Relay = { t: "producers", ids: [...producers] };
    if (to) relay(to, m); else relayAll(m);
  }

  function setProducer(id: string, on: boolean) {
    if (!isHost()) return;
    if (on) producers.add(id); else producers.delete(id);
    shareProducers();
    refresh();
    const who = people.get(id)?.name ?? "Participant";
    toast(on ? `${who} is now a producer.` : `${who} is no longer a producer.`, "success");
  }

  function sendChat(text: string) {
    const t = text.trim().slice(0, MAX_CHAT);
    if (!t) return;
    relayAll({ t: "chat", text: t });
    workspace.addChat({ from: name, mine: true, text: t, at: Date.now() });
  }

  function handleRelay(from: string, m: Relay) {
    const sender = people.get(from);
    if (!sender) return;
    const fromHost = parseRole(sender.role) === "host";
    if (m.t === "producers") {
      if (!fromHost || isHost()) return;
      const before = myRole();
      producers.clear();
      m.ids.forEach((i) => producers.add(i));
      if (before !== myRole()) toast(myRole() === "producer" ? "You are now a producer." : "You are no longer a producer.", "success");
      refresh();
    } else if (m.t === "mute") {
      if (!fromHost && !producers.has(from)) return;
      setMic(false);
      toast(`${sender.name} asked you to mute.`);
    } else if (m.t === "chat") {
      workspace.addChat({ from: sender.name, mine: false, text: m.text, at: Date.now() });
      if (dock !== "people") toast(`${sender.name}: ${m.text.slice(0, 80)}`);
    }
  }

  function applySink(v: HTMLVideoElement) {
    const s = v as Sinkable;
    if (speakerId && !v.muted && s.setSinkId) void s.setSinkId(speakerId).catch(() => {});
  }

  function makeTile(id: string, mine: boolean, stream: MediaStream, label: string) {
    if (el(`tile-${id}`)) return;
    const tile = document.createElement("div");
    tile.className = "tile" + (mine ? " mine" : "");
    tile.id = `tile-${id}`;
    const v = document.createElement("video");
    v.autoplay = true; v.playsInline = true; v.muted = mine; v.srcObject = stream;
    applySink(v);
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
    const role = roleOf(p.id);
    const suffix = role === "host" ? " · host" : role === "producer" ? " · producer" : "";
    tile.querySelector(".name")!.textContent = `${p.name}${p.id === myId ? " (you)" : ""}${suffix}`;
    tile.classList.toggle("mic-off", !p.mic);
    tile.classList.toggle("camoff", !p.cam);
    tile.classList.toggle("sharing", p.sharing);
    tile.dataset.initial = (p.name[0] ?? "?").toUpperCase();
  }

  function markSpeaking(id: string, active: boolean) {
    if (!id) return;
    if (active) speaking.add(id); else speaking.delete(id);
    for (const row of $("panel").querySelectorAll<HTMLElement>("[data-peer]")) {
      if (row.dataset.peer === id) row.classList.toggle("speaking", active);
    }
  }

  function linkState(id: string): string {
    if (id === myId) return socketState === "online" ? "Connected" : socketState === "closed" ? "Disconnected" : "Connecting";
    switch (remotes.get(id)?.pc.connectionState) {
      case "connected": return "Connected";
      case "failed": return "Failed";
      case "disconnected": return "Unstable";
      case "closed": return "Disconnected";
      default: return "Connecting";
    }
  }

  function updateRoleChip() {
    const chip = $("roleChip");
    if (!people.get(myId)) { chip.hidden = true; return; }
    const role = myRole();
    chip.dataset.role = role;
    chip.textContent = ROLE_LABEL[role];
    chip.hidden = false;
  }

  function actionsFor(): PanelActions | null {
    if (isHost()) return { mute: host.mute, allowShare: host.allowShare, remove: host.remove, setProducer };
    if (myRole() === "producer") return { mute: (id) => { relay(id, { t: "mute" }); toast("Asked them to mute."); } };
    return null;
  }

  // One compact button for the host: switch views and assign producers.
  const viewMenu = createViewMenu({
    onView: (v: View) => {
      view = v;
      refresh();
      toast(v === "producer" ? "Producer view. Only you see this." : "Back to host view.");
    },
    onAssign: () => openAssignDialog({
      people: () => [...people.values()].filter((p) => p.id !== myId && parseRole(p.role) !== "host"),
      isProducer: (id) => producers.has(id),
      setProducer,
    }),
  });
  $("viewSlot").append(viewMenu.el);

  function refresh() {
    if (closed) return;
    for (const p of people.values()) paintTile(p);
    const list = [...people.values()].map((p) => ({ ...p, role: roleOf(p.id) }));
    workspace.setMode(mode());
    workspace.update(list, myId, actionsFor(), { speaking, link: linkState });
    updateRoleChip();
    viewMenu.el.hidden = !isHost();
    controls.more.hidden = !isHost();
    $("inviteBtn").hidden = myRole() === "guest";
  }

  function setDock(next: Dock) {
    dock = next;
    $("panel").hidden = next !== "people";
    $("moxie").hidden = next !== "moxie";
    controls.people.setAttribute("aria-pressed", String(next === "people"));
    controls.moxie.setAttribute("aria-pressed", String(next === "moxie"));
  }

  function copyLink() {
    void navigator.clipboard.writeText(inviteUrl()).then(
      () => toast("Meeting link copied.", "success"),
      () => { ($("inviteLink") as HTMLInputElement).select(); toast("Could not copy. Press Ctrl+C to copy the selected link.", "error"); },
    );
  }

  /**
   * BACKEND INTEGRATION POINT: invitations.
   * The link is the room URL from POST /api/rooms, so each meeting has its own id. Anyone with the link joins
   * as a guest. Per-person invites, expiring links or pre-assigned roles would need new server endpoints.
   */
  function openInvite() {
    const input = $("inviteLink") as HTMLInputElement;
    input.value = inviteUrl();
    ($("inviteDialog") as HTMLDialogElement).showModal();
    input.select();
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

  function toggleMoreMenu() { if (moreMenu) closeMoreMenu(); else openMoreMenu(); }

  function openMoreMenu() {
    if (!isHost()) return;
    const rect = controls.more.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.className = "more-menu";
    menu.setAttribute("role", "menu");
    menu.style.position = "fixed";
    menu.style.bottom = `${window.innerHeight - rect.top + 8}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;

    menu.append(
      menuItem("Copy meeting link", copyLink),
      menuItem("Invite people", openInvite),
      menuItem("Manage participants", () => setDock("people")),
      menuItem("Speaker report", () => { void showReport(roomId).then((ok) => { if (!ok) toast("Only the host can open the report.", "error"); }); }),
      divider(),
      menuItem("End meeting for everyone", () => {
        void confirmDialog({
          title: "End meeting for everyone?",
          message: "Everyone will be disconnected and the meeting will close. This cannot be undone.",
          confirmLabel: "End meeting",
          danger: true,
        }).then((ok) => { if (ok) host.end(); });
      }, true),
    );

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

  function onDocClick(e: MouseEvent) { if (moreMenu && !moreMenu.contains(e.target as Node)) closeMoreMenu(); }
  function onEsc(e: KeyboardEvent) { if (e.key === "Escape") closeMoreMenu(); }

  function onMessage(m: any) {
    switch (m.type) {
      case "welcome": {
        myId = m.id;
        people.clear();
        producers.clear();
        people.set(m.id, m.me);
        canShare = m.me.canShare;
        for (const p of m.peers as PeerState[]) {
          people.set(p.id, p);
          makeTile(p.id, false, new MediaStream(), p.name);
          createPeer(p, true);
        }
        announce();
        if (speakingNow) send({ type: "speaking", active: true });
        setStatus(m.peers.length ? "" : "Waiting for others. Use the add-person icon to share the link.");
        refresh();
        break;
      }
      case "peer-joined":
        people.set(m.peer.id, m.peer);
        makeTile(m.peer.id, false, new MediaStream(), m.peer.name);
        createPeer(m.peer, false);
        shareProducers(m.peer.id);
        setStatus("");
        refresh();
        break;
      case "peer-left":
        removeRemote(m.id);
        people.delete(m.id);
        speaking.delete(m.id);
        if (producers.delete(m.id)) shareProducers();
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
        markSpeaking(m.id, m.active === true);
        break;
      case "signal": {
        const rel = unwrap(m.data);
        if (rel) { handleRelay(m.from, rel); break; }
        const r = remotes.get(m.from);
        if (r) r.queue = r.queue.then(() => onSignal(m.from, r, m.data)).catch(console.error);
        break;
      }
      case "mute-request":
        setMic(false);
        toast("The host asked you to mute.");
        break;
      case "error":
        toast(m.message, "error");
        break;
    }
  }

  function onStatus(s: SocketStatus, reason?: string) {
    socketState = s;
    const label = { online: "Connected", reconnecting: "Reconnecting...", closed: "Disconnected" }[s];
    $("conn").dataset.state = s;
    $("conn").textContent = label;
    if (s === "reconnecting") { resetRemotes(); setStatus("Connection lost. Trying to reconnect..."); }
    else if (s === "closed") { finish(reason || "You were disconnected from this meeting."); }
  }

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
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") pc.restartIce();
      refresh();
    };
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

  function setMic(on: boolean) { audio().enabled = on; controls.setMic(on); announce(); }
  function setCam(on: boolean) { video().enabled = on; controls.setCam(on); announce(); }

  async function swapVideo(track: MediaStreamTrack) {
    for (const { pc } of remotes.values()) {
      await pc.getSenders().find((s) => s.track?.kind === "video")?.replaceTrack(track);
    }
    (el("tile-me")!.querySelector("video") as HTMLVideoElement).srcObject = new MediaStream([track]);
  }

  async function startShare() {
    if (!canShare) return toast("The host turned off screen sharing for you.", "error");
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

  // Audio device management (own device only)
  function startSpeaking() {
    return watchSpeaking(cam, (active) => {
      speakingNow = active;
      send({ type: "speaking", active });
      markSpeaking(myId, active);
      el("tile-me")?.classList.toggle("speaking", active);
    });
  }

  async function switchMic(deviceId: string) {
    const old = audio();
    const prev = old.getSettings();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: prev.echoCancellation ?? true,
        noiseSuppression: prev.noiseSuppression ?? true,
        autoGainControl: prev.autoGainControl ?? true,
      },
    });
    const next = stream.getAudioTracks()[0];
    next.enabled = old.enabled;
    for (const { pc } of remotes.values()) {
      await pc.getSenders().find((s) => s.track?.kind === "audio")?.replaceTrack(next);
    }
    cam.removeTrack(old);
    old.stop();
    cam.addTrack(next);
    stopSpeaking();
    stopSpeaking = startSpeaking();
  }

  async function setSpeaker(id: string): Promise<boolean> {
    speakerId = id;
    try {
      for (const v of document.querySelectorAll<HTMLVideoElement>("#grid video")) {
        const s = v as Sinkable;
        if (!v.muted && s.setSinkId) await s.setSinkId(id);
      }
      return true;
    } catch {
      return false;
    }
  }

  const settings = createSettings({
    audioTrack: audio,
    cameraStream: () => cam,
    speakerId: () => speakerId,
    supportsSpeaker: typeof (HTMLMediaElement.prototype as Sinkable).setSinkId === "function",
    setMic: switchMic,
    setSpeaker,
    setProcessing: (c) => audio().applyConstraints(c),
  });

  function cleanup() {
    closed = true;
    workspace.destroy();
    viewMenu.close();
    closeMoreMenu();
    settings.destroy();
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

  makeTile("me", true, cam, `${name} (you)`);
  $("moxie").append(createMoxiePanel(() => setDock(null)));
  controls.setMic(audio().enabled);
  controls.setCam(video().enabled);
  controls.setShare(false, true);
  controls.more.hidden = true;
  controls.moxie.onclick = () => setDock(dock === "moxie" ? null : "moxie");
  controls.mic.onclick = () => setMic(!audio().enabled);
  controls.cam.onclick = () => setCam(!video().enabled);
  controls.share.onclick = () => (screen ? void stopShare() : void startShare());
  controls.people.onclick = () => setDock(dock === "people" ? null : "people");
  controls.more.onclick = (e) => { e.stopPropagation(); toggleMoreMenu(); };
  controls.leave.onclick = async () => {
    if (isHost()) {
      const choice = await askLeave();
      if (choice === "cancel") return;
      if (choice === "end") return host.end();
    }
    leave();
  };

  $("inviteBtn").onclick = openInvite;
  $("inviteCopy").onclick = copyLink;
  $("settingsBtn").onclick = () => void settings.open();
  $("helpBtn").onclick = () => ($("helpDialog") as HTMLDialogElement).showModal();

  stopSpeaking = startSpeaking();
  setDock(window.matchMedia("(min-width: 1000px)").matches ? "people" : null);
  socket.connect();
}