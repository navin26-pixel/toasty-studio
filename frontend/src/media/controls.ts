const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const svgFilled = (body: string) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">${body}</svg>`;

const SLASH = '<path d="M3 3l18 18"/>';
const MIC = '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3"/>';
const CAM = '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3z"/>';

export const icon = {
  mic: svg(MIC),
  micOff: svg(MIC + SLASH),
  cam: svg(CAM),
  chat: svg('<path d="M4 5h16v11H9l-5 4z"/>'),
  camOff: svg(CAM + SLASH),
  screen: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
  people: svg('<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14a5 5 0 0 1 5 5"/>'),
  leave: svg('<path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M16 8l4 4-4 4M20 12H9"/>'),
  more: svgFilled('<circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/>'),
  spark: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>'),
  notes: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M9 11h7M9 15h7"/>'),
  media: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M10 9l5 3-5 3z"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
};

function paint(b: HTMLButtonElement, ico: string, label: string) {
  b.innerHTML = `${ico}<span>${label}</span>`;
  b.setAttribute("aria-label", label);
}

export function buildControls(root: HTMLElement) {
  const make = (cls: string, ico: string, label: string) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `ctl ${cls}`;
    paint(b, ico, label);
    root.append(b);
    return b;
  };
  // Moxie sits first, with extra spacing (see .ctl.moxie), so it reads as a separate feature.
  const moxie = make("moxie", icon.spark, "Moxie AI");
  moxie.title = "Moxie AI";
  moxie.setAttribute("aria-pressed", "false");
  const mic = make("mic", icon.mic, "Mute");
  const cam = make("cam", icon.cam, "Stop video");
  const share = make("share", icon.screen, "Share screen");
  const people = make("people", icon.people, "People");
  people.setAttribute("aria-pressed", "false");
  const more = make("more", icon.more, "More");
  more.setAttribute("aria-haspopup", "menu");
  more.setAttribute("aria-expanded", "false");
  const leave = make("leave", icon.leave, "Leave");

  return {
    moxie, mic, cam, share, people, more, leave,
    setMic(on: boolean) {
      mic.classList.toggle("off", !on);
      paint(mic, on ? icon.mic : icon.micOff, on ? "Mute" : "Unmute");
    },
    setCam(on: boolean) {
      cam.classList.toggle("off", !on);
      paint(cam, on ? icon.cam : icon.camOff, on ? "Stop video" : "Start video");
    },
    setShare(sharing: boolean, allowed: boolean) {
      share.classList.toggle("on", sharing);
      share.disabled = !allowed && !sharing;
      share.title = allowed ? "" : "The host turned off screen sharing for you";
      paint(share, icon.screen, sharing ? "Stop sharing" : "Share screen");
    },
  };
}