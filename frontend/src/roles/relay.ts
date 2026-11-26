/**
 * Small tagged messages that people send each other through the existing "signal" relay.
 * The server stamps every relayed message with who sent it, so a receiver can check the sender.
 *
 * BACKEND INTEGRATION POINT: this is enforced in each browser, not by the server. Real producer authority
 * (remove, block sharing, persistence across host reloads) needs the server to know about the producer role.
 * When it does, replace this with real "host" actions and keep the UI as it is.
 */
export type Relay =
  | { t: "producers"; ids: string[] }
  | { t: "mute" }
  | { t: "chat"; text: string };

export const MAX_CHAT = 500;

export function wrap(m: Relay) {
  return { toasty: m };
}

export function unwrap(data: unknown): Relay | null {
  const m = (data as { toasty?: any } | null)?.toasty;
  if (!m || typeof m !== "object") return null;
  if (m.t === "mute") return { t: "mute" };
  if (m.t === "chat" && typeof m.text === "string") {
    const text = m.text.trim().slice(0, MAX_CHAT);
    return text ? { t: "chat", text } : null;
  }
  if (m.t === "producers" && Array.isArray(m.ids)) {
    const ids = m.ids.filter((x: unknown): x is string => typeof x === "string").slice(0, 64);
    return { t: "producers", ids };
  }
  return null;
}