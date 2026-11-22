export type Config = { iceServers: RTCIceServer[]; maxPeers: number };

export const hostTokenKey = (roomId: string) => `toasty:host:${roomId}`;

export async function createMeeting(): Promise<{ roomId: string; hostToken: string }> {
  const res = await fetch("/api/rooms", { method: "POST" });
  if (!res.ok) throw new Error("Could not create the meeting.");
  return res.json();
}

export async function checkMeeting(roomId: string): Promise<"ok" | "missing" | "ended" | "error"> {
  try {
    const res = await fetch(`/api/rooms/${roomId}`);
    return res.ok ? "ok" : res.status === 404 ? "missing" : res.status === 410 ? "ended" : "error";
  } catch {
    return "error";
  }
}

export async function getConfig(): Promise<Config> {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error("Could not load settings.");
  return res.json();
}

export async function getReport(roomId: string): Promise<any | null> {
  const token = localStorage.getItem(hostTokenKey(roomId)) ?? "";
  const res = await fetch(`/api/rooms/${roomId}/report?token=${encodeURIComponent(token)}`);
  return res.ok ? res.json() : null;
}