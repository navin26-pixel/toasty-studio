import "./style.css";

type PeerInfo = { id: string; name: string; role: string };
type Remote = { pc: RTCPeerConnection; tile: HTMLElement; queue: Promise<void> };
type Config = { iceServers: RTCIceServer[]; maxPeers: number };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const roomId = location.pathname.match(/^\/r\/([\w-]+)/)?.[1] ?? null;
const savedName = () => localStorage.getItem("toasty:name") ?? "";

let config: Config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }], maxPeers: 4 };
let ws: WebSocket | null = null;
let myId = "";
let myName = "";
let cam: MediaStream | null = null;
let screen: MediaStream | null = null;
let leaving = false;
let retry = 0;
const remotes = new Map<string, Remote>();

function show(view: "home" | "lobby" | "room") {
  for (const id of ["home", "lobby", "room"]) $(id).hidden = id !== view;
}

// ---------- Home: create a meeting ----------
async function initHome() {
  show("home");
  $<HTMLInputElement>("homeName").value = savedName();
  $("create").onclick = async () => {
    const name = $<HTMLInputElement>("homeName").value.trim();
    if (!name) return void ($("homeError").textContent = "Enter your name to start.");
    localStorage.setItem("toasty:name", name);
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      const { roomId: id, hostToken } = await res.json();
      localStorage.setItem(`toasty:host:${id}`, hostToken);
      location.href = `/r/${id}`;
    } catch {
      $("homeError").textContent = "Could not reach the server. Check your connection and try again.";
    }
  };
}

// ---------- Lobby: camera preview, then join ----------
async function initLobby(id: string) {
  const res = await fetch(`/api/rooms/${id}`);
  if (!res.ok) {
    show("lobby");
    $("join").hidden = true;
    $("lobbyError").textContent = "This meeting does not exist or has been closed. Ask the host for a new link.";
    return;
  }
  config = await (await fetch("/api/config")).json();
  show("lobby");
  $<HTMLInputElement>("lobbyName").value = savedName();
  try {
    cam = await navigator.mediaDevices.getUserMedia({ video: true, audio: { echoCancellation: true, noiseSuppression: true } });
    $<HTMLVideoElement>("preview").srcObject = cam;
  } catch {
    $("lobbyError").textContent = "Camera or microphone is blocked. Allow access in the browser address bar, then reload.";
    return;
  }
  $("join").onclick = () => {
    const name = $<HTMLInputElement>("lobbyName").value.trim();
    if (!name) return void ($("lobbyError").textContent = "Enter your name to join.");
    myName = name;
    localStorage.setItem("toasty:name", name);
    startMeeting(id);
  };
}

// ---------- Meeting ----------
function startMeeting(id: string) {
  show("room");
  addTile("me", `${myName} (you)`, cam!, true);
  wireControls(id);
  connect(id);
}

function setStatus(text: string) { $("status").textContent = text; }

function connect(id: string) {
  const token = localStorage.getItem(`toasty:host:${id}`) ?? "";
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws/${id}?name=${encodeURIComponent(myName)}&token=${encodeURIComponent(token)}`);
  ws.onopen = () => { retry = 0; };
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = (e) => {
    clearRemotes();
    if (leaving) return;
    if (e.code === 4404 || e.code === 4409) return setStatus(e.reason || "Could not join this meeting.");
    retry++;
    setStatus("Connection lost. Reconnecting...");
    setTimeout(() => connect(id), Math.min(1000 * retry, 5000));
  };
}

function send(msg: object) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }

function handle(msg: any) {
  if (msg.type === "welcome") {
    myId = msg.id;
    setStatus(msg.peers.length ? "" : "Waiting for others. Copy the link and send it.");
    // The newcomer makes the offers, so two people never offer at the same time.
    for (const p of msg.peers as PeerInfo[]) createPeer(p, true);
  } else if (msg.type === "peer-joined") {
    createPeer(msg.peer, false);
    setStatus("");
  } else if (msg.type === "peer-left") {
    removeRemote(msg.id);
    if (!remotes.size) setStatus("Everyone else left. You can wait here or leave.");
  } else if (msg.type === "signal") {
    const r = remotes.get(msg.from);
    if (r) r.queue = r.queue.then(() => onSignal(msg.from, r, msg.data)).catch(console.error);
  }
}

function createPeer(p: PeerInfo, offer: boolean) {
  if (remotes.has(p.id)) return;
  const pc = new RTCPeerConnection({ iceServers: config.iceServers });
  const tile = addTile(p.id, p.role === "host" ? `${p.name} (host)` : p.name, new MediaStream(), false);
  const r: Remote = { pc, tile, queue: Promise.resolve() };
  remotes.set(p.id, r);

  const outgoing = (screen ?? cam)!;
  for (const t of cam!.getAudioTracks()) pc.addTrack(t, cam!);
  for (const t of outgoing.getVideoTracks()) pc.addTrack(t, cam!);

  pc.onicecandidate = (e) => e.candidate && send({ type: "signal", to: p.id, data: { candidate: e.candidate } });
  pc.ontrack = (e) => {
    const video = tile.querySelector("video")!;
    const stream = (video.srcObject as MediaStream) ?? new MediaStream();
    if (!stream.getTracks().includes(e.track)) stream.addTrack(e.track);
    video.srcObject = stream;
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed") pc.restartIce();
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
  if (data.sdp) {
    await pc.setRemoteDescription(data.sdp);
    if (data.sdp.type === "offer") {
      await pc.setLocalDescription(await pc.createAnswer());
      send({ type: "signal", to: from, data: { sdp: pc.localDescription } });
    }
  } else if (data.candidate) {
    await pc.addIceCandidate(data.candidate).catch(() => {});
  }
}

function removeRemote(id: string) {
  const r = remotes.get(id);
  if (!r) return;
  r.pc.close();
  r.tile.remove();
  remotes.delete(id);
}
function clearRemotes() { for (const id of [...remotes.keys()]) removeRemote(id); }

function addTile(id: string, label: string, stream: MediaStream, mine: boolean) {
  const tile = document.createElement("div");
  tile.className = "tile" + (mine ? " mine" : "");
  tile.id = `tile-${id}`;
  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.muted = mine; // never play your own audio back
  if (mine) video.className = "cam";
  video.srcObject = stream;
  const name = document.createElement("span");
  name.textContent = label;
  tile.append(video, name);
  $("grid").append(tile);
  return tile;
}

// ---------- Controls ----------
function wireControls(id: string) {
  const mic = $("mic"), camBtn = $("cam"), share = $("share");
  mic.onclick = () => {
    const track = cam!.getAudioTracks()[0];
    track.enabled = !track.enabled;
    mic.textContent = track.enabled ? "Mute" : "Unmute";
    mic.classList.toggle("off", !track.enabled);
  };
  camBtn.onclick = () => {
    const track = cam!.getVideoTracks()[0];
    track.enabled = !track.enabled;
    camBtn.textContent = track.enabled ? "Stop video" : "Start video";
    camBtn.classList.toggle("off", !track.enabled);
  };
  share.onclick = async () => {
    if (screen) return stopShare();
    try {
      screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
    } catch { return; } // person cancelled the picker
    const track = screen.getVideoTracks()[0];
    track.onended = stopShare;
    await swapVideo(track);
    share.textContent = "Stop sharing";
    share.classList.add("off");
  };
  $("copy").onclick = async () => {
    await navigator.clipboard.writeText(`${location.origin}/r/${id}`);
    $("copy").textContent = "Link copied";
    setTimeout(() => ($("copy").textContent = "Copy link"), 1500);
  };
  $("leave").onclick = () => {
    leaving = true;
    ws?.close();
    clearRemotes();
    cam?.getTracks().forEach((t) => t.stop());
    screen?.getTracks().forEach((t) => t.stop());
    location.href = `/r/${id}`; // back to the lobby, so rejoining is one click
  };
}

async function swapVideo(track: MediaStreamTrack) {
  for (const { pc } of remotes.values()) {
    const sender = pc.getSenders().find((s) => s.track?.kind === "video");
    await sender?.replaceTrack(track);
  }
  const mine = document.querySelector<HTMLVideoElement>("#tile-me video")!;
  mine.srcObject = new MediaStream([track]);
  mine.classList.toggle("cam", track.getSettings().displaySurface === undefined);
}

async function stopShare() {
  screen?.getTracks().forEach((t) => t.stop());
  screen = null;
  await swapVideo(cam!.getVideoTracks()[0]);
  const mine = document.querySelector<HTMLVideoElement>("#tile-me video")!;
  mine.srcObject = cam;
  mine.classList.add("cam");
  $("share").textContent = "Share screen";
  $("share").classList.remove("off");
}

roomId ? initLobby(roomId) : initHome();
