import { h } from "../ui/dom";

export type View = "host" | "producer";

const CHEV = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

/**
 * One compact button for the host. Its menu switches between Host view and Producer view and opens Assign producer.
 * Switching views changes only what is shown, never what the host is allowed to do.
 */
export function createViewMenu(opts: { onView(v: View): void; onAssign(): void }) {
  const el = h("div", "view-menu");
  el.hidden = true;
  const btn = h("button", "view-btn", "", {
    type: "button",
    "aria-haspopup": "menu",
    "aria-expanded": "false",
    title: "Switch view or assign a producer",
  });
  el.append(btn);
  let view: View = "host";
  let menu: HTMLElement | null = null;

  const paint = () => { btn.innerHTML = `<span>${view === "host" ? "Host view" : "Producer view"}</span>${CHEV}`; };
  paint();

  const onDoc = (e: MouseEvent) => { if (menu && !menu.contains(e.target as Node)) close(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };

  function close() {
    if (!menu) return;
    menu.remove();
    menu = null;
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDoc);
    document.removeEventListener("keydown", onKey);
  }

  function item(label: string, onClick: () => void, checked?: boolean) {
    const b = h("button", "more-item", label, { type: "button", role: checked === undefined ? "menuitem" : "menuitemradio" });
    if (checked !== undefined) b.setAttribute("aria-checked", String(checked));
    b.onclick = () => { close(); onClick(); };
    return b;
  }

  function open() {
    const rect = btn.getBoundingClientRect();
    menu = h("div", "more-menu", "", { role: "menu" });
    menu.style.position = "fixed";
    menu.style.top = `${rect.bottom + 8}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    menu.append(
      item("Host view", () => { view = "host"; paint(); opts.onView("host"); }, view === "host"),
      item("Producer view", () => { view = "producer"; paint(); opts.onView("producer"); }, view === "producer"),
      h("div", "more-divider"),
      item("Assign producer...", opts.onAssign),
      h("p", "more-note", "Views change what you see, not what you can do."),
    );
    document.body.append(menu);
    btn.setAttribute("aria-expanded", "true");
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
  }

  btn.onclick = (e) => { e.stopPropagation(); if (menu) close(); else open(); };

  return {
    el,
    setView(v: View) { view = v; paint(); },
    close,
  };
}