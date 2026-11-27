import { h } from "../ui/dom";
import { icon } from "../media/controls";
import { watchLevel } from "../media/level";
import { toast } from "../ui/toast";

/**
 * Audio and video settings for the person using this browser. Everything here affects only their own
 * devices. Session-wide audio management by a producer needs backend support and is not included.
 *
 * BACKGROUND EFFECTS (not implemented): blur or replacement needs a per-frame person-segmentation step that
 * outputs a processed video track. That track would be passed through swapVideo() in meeting.ts, which already
 * uses replaceTrack() for screen sharing. Until then the options below stay disabled.
 */
export type SettingsApi = {
  audioTrack(): MediaStreamTrack;
  cameraStream(): MediaStream;
  speakerId(): string;
  supportsSpeaker: boolean;
  setMic(deviceId: string): Promise<void>;
  setSpeaker(deviceId: string): Promise<boolean>;
  setProcessing(c: MediaTrackConstraints): Promise<void>;
};

type Tab = "audio" | "video";
const PROCESSING = [
  { key: "echoCancellation", label: "Echo cancellation", hint: "Reduces your speakers being picked up by your microphone." },
  { key: "noiseSuppression", label: "Noise suppression", hint: "Reduces steady background noise such as fans." },
  { key: "autoGainControl", label: "Automatic gain", hint: "Evens out your volume. Turn off for studio microphones." },
] as const;

export function createSettings(api: SettingsApi) {
  const dialog = h("dialog", "settings");
  const close = h("button", "icon-btn", "", { type: "button", "aria-label": "Close settings" });
  close.innerHTML = icon.close;
  close.onclick = () => dialog.close();
  dialog.append(Object.assign(h("div", "set-head"), {}));
  dialog.firstElementChild!.append(h("h2", "", "Settings"), close);

  const tabsEl = h("div", "set-tabs", "", { role: "tablist" });
  const body = h("div", "set-body");
  const tabButtons = new Map<Tab, HTMLButtonElement>();
  const panes = new Map<Tab, HTMLElement>();
  for (const [id, label] of [["audio", "Audio"], ["video", "Video"]] as [Tab, string][]) {
    const b = h("button", "ws-tab", label, { type: "button", role: "tab" });
    b.onclick = () => showTab(id);
    tabButtons.set(id, b);
    tabsEl.append(b);
    const pane = h("div", "set-pane", "", { role: "tabpanel" });
    panes.set(id, pane);
    body.append(pane);
  }
  dialog.append(tabsEl, body);

  // Audio pane
  const audio = panes.get("audio")!;
  const mic = h("select", "", "", { "aria-label": "Microphone" });
  const meter = h("div", "meter");
  const bar = h("i");
  meter.append(bar);
  const meterNote = h("p", "set-hint");
  const speaker = h("select", "", "", { "aria-label": "Speaker" });

  const micField = h("div", "field");
  micField.append(h("label", "", "Microphone"), mic, meter, meterNote);
  const spkField = h("div", "field");
  spkField.append(h("label", "", "Speaker"));
  if (api.supportsSpeaker) spkField.append(speaker);
  else spkField.append(h("p", "set-hint", "Your browser does not let websites choose a speaker. Use your system sound settings."));

  const procField = h("div", "field");
  procField.append(h("span", "label", "Processing"));
  const boxes = new Map<string, HTMLInputElement>();
  for (const p of PROCESSING) {
    const row = h("label", "toggle-row");
    const text = h("span");
    text.append(document.createTextNode(p.label), h("small", "", p.hint));
    const box = h("input", "", "", { type: "checkbox" });
    boxes.set(p.key, box);
    box.onchange = async () => {
      try { await api.setProcessing({ [p.key]: box.checked }); }
      catch { toast(`Could not change ${p.label.toLowerCase()}.`, "error"); }
      syncProcessing();
    };
    row.append(text, box);
    procField.append(row);
  }
  procField.append(h("p", "set-hint", "These settings change only your own microphone. Other people manage their own devices."));
  audio.append(micField, spkField, procField);

  function syncProcessing() {
    const s = api.audioTrack().getSettings() as Record<string, unknown>;
    for (const p of PROCESSING) {
      const box = boxes.get(p.key)!;
      const v = s[p.key];
      box.disabled = typeof v !== "boolean";
      box.checked = v === true;
      box.title = box.disabled ? "Not reported by this browser or device" : "";
    }
  }

  function fill(sel: HTMLSelectElement, devs: MediaDeviceInfo[], current: string, fallback: string) {
    sel.replaceChildren();
    devs.forEach((d, i) => {
      const o = h("option", "", d.label || `${fallback} ${i + 1}`);
      o.value = d.deviceId;
      sel.append(o);
    });
    if (current && devs.some((d) => d.deviceId === current)) sel.value = current;
  }

  async function fillDevices() {
    let list: MediaDeviceInfo[] = [];
    try { list = await navigator.mediaDevices.enumerateDevices(); } catch { /* ignore */ }
    fill(mic, list.filter((d) => d.kind === "audioinput"), api.audioTrack().getSettings().deviceId ?? "", "Microphone");
    if (api.supportsSpeaker) fill(speaker, list.filter((d) => d.kind === "audiooutput"), api.speakerId(), "Speaker");
  }

  let stopMeter = () => {};
  function startMeter() {
    stopMeter();
    const track = api.audioTrack();
    meterNote.textContent = track.enabled ? "Speak and the bar should move." : "Your microphone is muted, so no level is shown.";
    stopMeter = watchLevel(new MediaStream([track]), (v) => { bar.style.width = `${Math.round(v * 100)}%`; });
  }

  mic.onchange = async () => {
    try { await api.setMic(mic.value); startMeter(); syncProcessing(); }
    catch { toast("Could not switch to that microphone.", "error"); await fillDevices(); }
  };
  speaker.onchange = async () => {
    if (!(await api.setSpeaker(speaker.value))) toast("Could not switch to that speaker.", "error");
  };

  // Video pane
  const video = panes.get("video")!;
  const preview = h("video", "set-preview", "", { autoplay: "", muted: "", playsinline: "" });
  preview.muted = true;
  const camField = h("div", "field");
  camField.append(h("label", "", "Camera preview"), preview);
  const bgField = h("div", "field");
  bgField.append(h("span", "label", "Background"));
  const grid = h("div", "bg-grid");
  for (const [label, hint, available] of [
    ["Original", "Your camera, unchanged", true],
    ["Blur", "Coming soon", false],
    ["Replace", "Coming soon", false],
  ] as [string, string, boolean][]) {
    const b = h("button", "bg-opt", label, { type: "button", "aria-pressed": String(available) });
    b.append(h("small", "", hint));
    b.disabled = !available;
    grid.append(b);
  }
  bgField.append(grid, h("p", "set-hint", "Blur and replacement are not available yet. They need a video-processing step that is not part of Toasty Studio today."));
  video.append(camField, bgField);

  function showTab(id: Tab) {
    for (const [t, b] of tabButtons) {
      b.setAttribute("aria-selected", String(t === id));
      panes.get(t)!.hidden = t !== id;
    }
    if (id === "audio") startMeter(); else stopMeter();
  }

  const onDeviceChange = () => { if (dialog.open) void fillDevices(); };
  navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => { stopMeter(); preview.srcObject = null; });
  document.body.append(dialog);

  return {
    async open(tab: Tab = "audio") {
      preview.srcObject = new MediaStream(api.cameraStream().getVideoTracks());
      dialog.showModal();
      showTab(tab);
      await fillDevices();
      syncProcessing();
    },
    destroy() {
      stopMeter();
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
      if (dialog.open) dialog.close();
      dialog.remove();
    },
  };
}