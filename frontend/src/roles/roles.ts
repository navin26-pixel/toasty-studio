/**
 * UI roles. These only decide what the interface SHOWS.
 * They are not security: the backend must authorize every host or producer action.
 */
export type Role = "host" | "producer" | "guest";

export const ROLE_LABEL: Record<Role, string> = {
  host: "Host",
  producer: "Producer",
  guest: "Guest",
};

/** Maps the role string sent by the server to a UI role. Anything unknown is treated as a guest. */
export function parseRole(raw: string | undefined): Role {
  return raw === "host" || raw === "producer" ? raw : "guest";
}