import { renderPanel, type PanelActions, type PanelOptions, type PeerState } from "../participants/panel";
import { icon } from "../media/controls";
import { createMediaTab } from "./media-tab";
import { h } from "../ui/dom";

type AgendaItem = { text: string; done: boolean };
type Moment = { at: number; label: string };
type Saved = { notes: string; agenda: AgendaItem[]; moments: Moment[] };
type TabId = "people" | "chat" | "notes" | "media";
export type Mode = "guest" | "host" | "producer";
export type ChatMessage = { from: string; mine: boolean; text: string; at: number };

export type Workspace = {
  /** Refreshes the people list only, so typing in notes or chat is never interrupted. */
  update(people: PeerState[], myId: string, actions: PanelActions | null, opts?: PanelOptions): void;
  /** guest: people, chat, private notes. host: adds agenda. producer: adds moments and media. Display only, not permission. */
  setMode(mode: Mode): void;
  addChat(msg: ChatMessage): void;
  destroy(): void;
};

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "people", label: "People", icon: icon.people },
  { id: "chat", label: "Chat", icon: icon.chat },
  { id: "notes", label: "Notes", icon: icon.notes },
  { id: "media", label: "Media", icon: icon.media },
];

function load(key: string): Saved {
  const empty: Saved = { notes: "", agenda: [], moments: [] };
  try {
    const d = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!d) return empty;
    return {
      notes: typeof d.notes === "string" ? d.notes : "",
      agenda: Array.isArray(d.agenda) ? d.agenda : [],
      moments: Array.isArray(d.moments) ? d.moments : [],
    };
  } catch {
    return empty;
  }
}

function persist(key: string, data: Saved) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* storage unavailable */ }
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const shortClock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function elapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const hours = Math.floor(m / 60);
  const two = (n: number) => String(n).padStart(2, "0");
  return hours ? `${hours}:${two(m % 60)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

/**
 * Sidebar for everyone. Notes, agenda and moments are saved in this browser only (localStorage).
 * Chat is in memory and reaches only people in the meeting right now.
 */
export function createWorkspace(
  root: HTMLElement,
  opts: { roomId: string; startedAt: number; onChat: (text: string) => void },
): Workspace {
  const key = `toasty:producer:${opts.roomId}`;
  const data = load(key);
  root.replaceChildren();

  const header = h("div", "ws-header");
  const timer = h("span", "ws-timer", "0:00");
  header.append(h("span", "ws-timer-label", "Since you joined"), timer);
  const tick = () => { timer.textContent = elapsed(Date.now() - opts.startedAt); };
  tick();
  const interval = setInterval(tick, 1000);

  const tabs = h("div", "ws-tabs", "", { role: "tablist", "aria-label": "Sidebar" });
  const body = h("div", "ws-body");
  const buttons = new Map<TabId, HTMLButtonElement>();
  const panes = new Map<TabId, HTMLElement>();
  let current: TabId = "people";

  function showTab(id: TabId) {
    current = id;
    for (const t of TABS) {
      const on = t.id === id;
      const b = buttons.get(t.id)!;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      panes.get(t.id)!.hidden = !on;
    }
    if (id === "chat") delete buttons.get("chat")!.dataset.unread;
  }

  for (const t of TABS) {
    const b = h("button", "ws-tab", "", { type: "button", role: "tab", id: `ws-tab-${t.id}`, "aria-controls": `ws-pane-${t.id}` });
    b.innerHTML = `${t.icon}<span>${t.label}</span>`;
    b.onclick = () => showTab(t.id);
    const pane = h("div", "ws-pane", "", { role: "tabpanel", id: `ws-pane-${t.id}`, "aria-labelledby": `ws-tab-${t.id}`, "data-pane": t.id });
    buttons.set(t.id, b);
    panes.set(t.id, pane);
    tabs.append(b);
    body.append(pane);
  }

  tabs.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const ids = TABS.filter((t) => !buttons.get(t.id)!.hidden).map((t) => t.id);
    const at = ids.indexOf(current);
    const next = ids[(at + (e.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length];
    showTab(next);
    buttons.get(next)!.focus();
  });

  const peoplePane = panes.get("people")!;

  // Chat
  const chatPane = panes.get("chat")!;
  const chatLog = h("div", "chat-log", "", { role: "log", "aria-live": "polite" });
  const chatEmpty = h("p", "ws-help", "No messages yet. Chat reaches people in the meeting right now and is not saved.");
  chatLog.append(chatEmpty);
  const chatForm = h("form", "chat-form");
  const chatInput = h("input", "", "", { type: "text", placeholder: "Message everyone", "aria-label": "Chat message", maxlength: "500", autocomplete: "off" });
  chatForm.append(chatInput, h("button", "ctl primary", "Send", { type: "submit" }));
  chatForm.onsubmit = (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = "";
    opts.onChat(text);
  };
  chatPane.append(chatLog, chatForm);

  // Notes
  const notesPane = panes.get("notes")!;

  const momentsSection = h("section", "ws-section");
  const momentForm = h("form", "ws-inline");
  const momentInput = h("input", "", "", { type: "text", placeholder: "What happened? (optional)", "aria-label": "Moment label", maxlength: "80" });
  momentForm.append(momentInput, h("button", "ctl primary", "Mark", { type: "submit" }));
  const momentList = h("ul", "ws-list");
  momentsSection.append(
    h("h3", "", "Moments"),
    h("p", "ws-help", "Mark a time you want to find later, such as a good quote or something to fix."),
    momentForm,
    momentList,
  );

  const agendaSection = h("section", "ws-section");
  const agendaForm = h("form", "ws-inline");
  const agendaInput = h("input", "", "", { type: "text", placeholder: "Add a topic", "aria-label": "New agenda topic", maxlength: "120" });
  agendaForm.append(agendaInput, h("button", "ctl", "Add", { type: "submit" }));
  const agendaList = h("ul", "ws-list");
  agendaSection.append(h("h3", "", "Agenda"), agendaForm, agendaList);

  const notesSection = h("section", "ws-section");
  const area = h("textarea", "ws-notes", "", { placeholder: "Write notes for yourself", "aria-label": "Private notes", rows: "8" });
  area.value = data.notes;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  area.oninput = () => {
    data.notes = area.value;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persist(key, data), 400);
  };
  notesSection.append(h("h3", "", "Private notes"), h("p", "ws-help", "Saved on this device only. Nobody else sees them."), area);

  notesPane.append(momentsSection, agendaSection, notesSection);
  panes.get("media")!.append(createMediaTab());

  function renderMoments() {
    momentList.replaceChildren();
    if (!data.moments.length) { momentList.append(h("li", "ws-empty", "No moments yet.")); return; }
    for (const m of [...data.moments].reverse()) {
      const li = h("li", "ws-item");
      li.append(h("span", "ws-time", clock(m.at)), h("span", "ws-text", m.label || "Marked"));
      momentList.append(li);
    }
  }

  function renderAgenda() {
    agendaList.replaceChildren();
    if (!data.agenda.length) { agendaList.append(h("li", "ws-empty", "No topics yet.")); return; }
    data.agenda.forEach((item, i) => {
      const li = h("li", "ws-item");
      li.classList.toggle("done", item.done);
      const box = h("input", "", "", { type: "checkbox", "aria-label": `Done: ${item.text}` });
      box.checked = item.done;
      box.onchange = () => { item.done = box.checked; li.classList.toggle("done", item.done); persist(key, data); };
      const del = h("button", "ctl mini", "Remove", { type: "button", "aria-label": `Remove ${item.text}` });
      del.onclick = () => { data.agenda.splice(i, 1); persist(key, data); renderAgenda(); };
      li.append(box, h("span", "ws-text", item.text), del);
      agendaList.append(li);
    });
  }

  momentForm.onsubmit = (e) => {
    e.preventDefault();
    data.moments.push({ at: Date.now(), label: momentInput.value.trim() });
    momentInput.value = "";
    persist(key, data);
    renderMoments();
  };

  agendaForm.onsubmit = (e) => {
    e.preventDefault();
    const text = agendaInput.value.trim();
    if (!text) return;
    data.agenda.push({ text, done: false });
    agendaInput.value = "";
    persist(key, data);
    renderAgenda();
  };

  showTab("people");
  renderMoments();
  renderAgenda();
  root.append(header, tabs, body);

  return {
    update(people, myId, actions, popts) { renderPanel(peoplePane, people, myId, actions, popts); },
    setMode(mode) {
      agendaSection.hidden = mode === "guest";
      momentsSection.hidden = mode !== "producer";
      buttons.get("media")!.hidden = mode !== "producer";
      if (mode !== "producer" && current === "media") showTab("people");
    },
    addChat(msg) {
      chatEmpty.remove();
      const m = h("div", "chat-msg");
      m.dataset.mine = String(msg.mine);
      const meta = h("div", "chat-meta");
      meta.append(h("span", "", msg.mine ? "You" : msg.from), h("span", "", shortClock(msg.at)));
      m.append(meta, h("div", "chat-text", msg.text));
      chatLog.append(m);
      while (chatLog.children.length > 200) chatLog.firstElementChild?.remove();
      body.scrollTop = body.scrollHeight;
      if (!msg.mine && current !== "chat") buttons.get("chat")!.dataset.unread = "true";
    },
    destroy() {
      clearInterval(interval);
      clearTimeout(saveTimer);
      persist(key, data);
      root.replaceChildren();
    },
  };
}