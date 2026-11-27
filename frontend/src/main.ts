import "@fontsource-variable/inter";
import "./styles/theme.css";
import "./styles/app.css";
import "./styles/components.css";
import { checkMeeting, createMeeting, getConfig, hostTokenKey, type Config } from "./services/api";
import { startMeeting } from "./meeting/meeting";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const roomId = location.pathname.match(/^\/r\/([\w-]+)/)?.[1] ?? null;
const savedName = () => localStorage.getItem("toasty:name") ?? "";

function show(view: "home" | "lobby" | "room") {
  for (const id of ["home", "lobby", "room"]) $(id).hidden = id !== view;
}

function initHome() {
  show("home");
  $<HTMLInputElement>("homeName").value = savedName();
  $("create").onclick = async () => {
    const name = $<HTMLInputElement>("homeName").value.trim();
    if (!name) return void ($("homeError").textContent = "Enter your name to start.");
    localStorage.setItem("toasty:name", name);
    try {
      const { roomId: id, hostToken } = await createMeeting();
      localStorage.setItem(hostTokenKey(id), hostToken);
      location.href = `/r/${id}`;
    } catch {
      $("homeError").textContent = "Could not reach the server. Check your connection and try again.";
    }
  };
}

async function initLobby(id: string) {
  show("lobby");
  const error = $("lobbyError");
  const status = await checkMeeting(id);
  if (status !== "ok") {
    for (const hide of ["join", "preview", "lobbyName", "cancel"]) $(hide).hidden = true;
    error.textContent =
      status === "ended" ? "This meeting has ended." :
      status === "missing" ? "This meeting does not exist. Ask the host for a new link." :
      "Could not reach the server. Check your connection and reload.";
    return;
  }

  let config: Config;
  try { config = await getConfig(); } catch { error.textContent = "Could not load settings. Reload the page."; return; }

  let cam: MediaStream;
  try {
    cam = await navigator.mediaDevices.getUserMedia({ video: true, audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    const kind = (e as DOMException).name;
    error.textContent =
      kind === "NotAllowedError" ? "Camera or microphone is blocked. Allow access in the browser address bar, then reload." :
      kind === "NotFoundError" ? "No camera or microphone was found. Plug one in and reload." :
      kind === "NotReadableError" ? "Your camera or microphone is being used by another app. Close it and reload." :
      "Could not start your camera and microphone.";
    $("join").hidden = true;
    $("cancel").onclick = () => { location.href = "/"; };
    return;
  }
  $<HTMLVideoElement>("preview").srcObject = cam;
  $<HTMLInputElement>("lobbyName").value = savedName();
  $<HTMLButtonElement>("join").disabled = false;
  $("join").onclick = () => {
    const name = $<HTMLInputElement>("lobbyName").value.trim();
    if (!name) return void (error.textContent = "Enter your name to join.");
    localStorage.setItem("toasty:name", name);
    show("room");
    startMeeting(id, name, cam, config);
  };
  $("cancel").onclick = () => {
    cam.getTracks().forEach((t) => t.stop());
    location.href = "/";
  };
}

roomId ? void initLobby(roomId) : initHome();