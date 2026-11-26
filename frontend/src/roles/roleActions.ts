/**
 * BACKEND INTEGRATION POINT: assigning a producer.
 *
 * The backend currently knows only "host" and "guest". While this flag is false the interface shows
 * "Make producer" as unavailable instead of sending messages that nothing handles.
 *
 * When the backend is ready, set it to true. Proposed messages, host only (the server must verify the
 * host token and must never trust the browser):
 *   { type: "host", action: "set-producer",   target }  -> server sets the target's role to "producer"
 *   { type: "host", action: "clear-producer", target }  -> server sets it back to "guest"
 * After either one the server broadcasts "peer-state" with the new role, and the UI updates by itself.
 */
export const PRODUCER_ROLE_SUPPORTED = false;

type Send = (m: object) => void;

export function assignProducer(send: Send, target: string) {
  send({ type: "host", action: "set-producer", target });
}

export function removeProducer(send: Send, target: string) {
  send({ type: "host", action: "clear-producer", target });
}