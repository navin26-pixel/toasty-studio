import { icon } from "../media/controls";

export type PeerState = {
  id: string; name: string; role: string;
  mic: boolean; cam: boolean; sharing: boolean; canShare: boolean;
};

export type HostActions = {
  remove(id: string): void;
  mute(id: string): void;
  allowShare(id: string, allowed: boolean): void;
};

function button(label: string, onClick: () => void, danger = false) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ctl mini" + (danger ? " danger" : "");
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

/** Rebuilds the participants list. Pass host actions only when the viewer is the host. */
export function renderPanel(root: HTMLElement, people: PeerState[], myId: string, actions: HostActions | null) {
  root.replaceChildren();
  const title = document.createElement("h2");
  title.textContent = `People (${people.length})`;
  root.append(title);

  for (const p of people) {
    const row = document.createElement("div");
    row.className = "row";
    const who = document.createElement("div");
    who.className = "who";
    const name = document.createElement("strong");
    name.textContent = p.id === myId ? `${p.name} (you)` : p.name; // textContent: names are never treated as HTML
    const role = document.createElement("span");
    role.className = "badge";
    role.textContent = p.role;
    who.append(name, role);

    const status = document.createElement("div");
    status.className = "status";
    status.innerHTML =
      `<span class="${p.mic ? "" : "off"}">${p.mic ? icon.mic : icon.micOff}</span>` +
      `<span class="${p.cam ? "" : "off"}">${p.cam ? icon.cam : icon.camOff}</span>` +
      (p.sharing ? `<span>${icon.screen}</span>` : "") +
      `<span>Connected</span>`;
    row.append(who, status);

    if (actions && p.id !== myId && p.role !== "host") {
      const acts = document.createElement("div");
      acts.className = "acts";
      acts.append(
        button("Ask to mute", () => actions.mute(p.id)),
        button(p.canShare ? "Block sharing" : "Allow sharing", () => actions.allowShare(p.id, !p.canShare)),
        button("Remove", () => actions.remove(p.id), true),
      );
      row.append(acts);
    }
    root.append(row);
  }
}