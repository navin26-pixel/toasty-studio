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
  camOff: svg(CAM + SLASH),
  screen: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
  people: svg('<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14a5 5 0 0 1 5 5"/>'),
  leave: svg('<path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M16 8l4 4-4 4M20 12H9"/>'),
  more: svgFilled('<circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/>'),
};

function paint(b: HTMLButtonElement, ico: string, label: string) {
  b.innerHTML = `${ico}<span>${label}</span>`;
  b.setAttribute("aria-label", label);
}

/** The bottom control bar. Five primary controls: mic, share, people, more, leave. */
export function buildControls(root: HTMLElement) {
  const make = (cls: string, ico: string, label: string) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `ctl ${cls}`;
    paint(b, ico, label);
    root.append(b);
    return b;
  };
  const mic = make("mic", icon.mic, "Mute");
  const share = make("share", icon.screen, "Share screen");
  const people = make("people", icon.people, "People");
  const more = make("more", icon.more, "More");
  more.setAttribute("aria-haspopup", "menu");
  more.setAttribute("aria-expanded", "false");
  const leave = make("leave", icon.leave, "Leave");

  return {
    mic, share, people, more, leave,
    setMic(on: boolean) {
      mic.classList.toggle("muted", !on);
      paint(mic, on ? icon.mic : icon.micOff, on ? "Mute" : "Unmute");
    },
    setShare(sharing: boolean, allowed: boolean) {
      share.classList.toggle("on", sharing);
      share.disabled = !allowed && !sharing;
      share.title = allowed ? "" : "The host turned off screen sharing for you";
      paint(share, icon.screen, sharing ? "Stop sharing" : "Share screen");
    },
  };
}