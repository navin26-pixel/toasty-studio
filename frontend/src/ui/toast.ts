export type ToastKind = "info" | "success" | "error";

const MAX_VISIBLE = 3;
let host: HTMLElement | null = null;

function container(): HTMLElement {
  if (!host) {
    host = document.createElement("div");
    host.id = "toasts";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.append(host);
  }
  return host;
}

/** Short, self-dismissing message for things that just happened. Use #status for ongoing state. */
export function toast(message: string, kind: ToastKind = "info", durationMs = 4000) {
  const root = container();
  while (root.children.length >= MAX_VISIBLE) root.firstElementChild?.remove();

  const el = document.createElement("div");
  el.className = "toast";
  el.dataset.kind = kind;
  el.textContent = message;
  root.append(el);

  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 200);
  }, durationMs);
}