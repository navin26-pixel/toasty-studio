import { icon } from "../media/controls";
import { parseRole, ROLE_LABEL } from "../roles/roles";
import { h } from "../ui/dom";

export type PeerState = {
  id: string; name: string; role: string;
  mic: boolean; cam: boolean; sharing: boolean; canShare: boolean;
};

/** Only the actions the current person is allowed to use are present. A button shows only if its action exists. */
export type PanelActions = {
  mute?(id: string): void;
  allowShare?(id: string, allowed: boolean): void;
  remove?(id: string, name: string): void;
  setProducer?(id: string, on: boolean): void;
};

export type PanelOptions = {
  speaking?: Set<string>;
  link?: (id: string) => string;
};

function button(label: string, onClick: () => void, danger = false) {
  const b = h("button", "ctl mini" + (danger ? " danger" : ""), label, { type: "button" });
  b.onclick = onClick;
  return b;
}

function hue(name: string) {
  let n = 0;
  for (const c of name) n = (n * 31 + (c.codePointAt(0) ?? 0)) % 360;
  return n;
}

export function avatar(name: string) {
  const a = h("div", "avatar", (name.trim()[0] ?? "?").toUpperCase());
  const hu = hue(name);
  a.style.background = `hsl(${hu} 30% 20%)`;
  a.style.color = `hsl(${hu} 60% 88%)`;
  return a;
}

export function renderPanel(
  root: HTMLElement,
  people: PeerState[],
  myId: string,
  actions: PanelActions | null,
  opts: PanelOptions = {},
) {
  root.replaceChildren();
  const title = h("h2", "", "People");
  title.append(h("span", "count", String(people.length)));
  root.append(title);

  for (const p of people) {
    const row = h("div", "row");
    row.dataset.peer = p.id;
    row.classList.toggle("speaking", !!opts.speaking?.has(p.id));

    const who = h("div", "who");
    who.append(
      h("strong", "", p.id === myId ? `${p.name} (you)` : p.name),
      h("span", "badge", ROLE_LABEL[parseRole(p.role)]),
    );

    const status = h("div", "status");
    status.innerHTML =
      `<span class="${p.mic ? "" : "off"}" title="${p.mic ? "Microphone on" : "Microphone off"}">${p.mic ? icon.mic : icon.micOff}</span>` +
      `<span class="${p.cam ? "" : "off"}" title="${p.cam ? "Camera on" : "Camera off"}">${p.cam ? icon.cam : icon.camOff}</span>` +
      (p.sharing ? `<span title="Sharing screen">${icon.screen}</span>` : "");
    const state = opts.link ? opts.link(p.id) : "Connected";
    const link = h("span", "link", state);
    link.dataset.state = state;
    const level = h("span", "level");
    level.append(h("i"), h("i"), h("i"));
    status.append(link, level);

    const main = h("div", "row-main");
    main.append(who, status);
    row.append(avatar(p.name), main);

    if (actions && p.id !== myId && p.role !== "host") {
      const acts = h("div", "acts");
      if (actions.mute) acts.append(button("Ask to mute", () => actions.mute!(p.id)));
      if (actions.allowShare) acts.append(button(p.canShare ? "Block sharing" : "Allow sharing", () => actions.allowShare!(p.id, !p.canShare)));
      if (actions.setProducer) {
        const on = parseRole(p.role) === "producer";
        acts.append(button(on ? "Remove producer" : "Make producer", () => actions.setProducer!(p.id, !on)));
      }
      if (actions.remove) acts.append(button("Remove", () => actions.remove!(p.id, p.name), true));
      if (acts.childElementCount) row.append(acts);
    }
    root.append(row);
  }
}