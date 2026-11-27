/** Tiny helper for building DOM nodes: tag, class, text and attributes. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = "",
  text = "",
  attrs: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}