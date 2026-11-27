import { hostTokenKey } from "./api";

export type SocketStatus = "online" | "reconnecting" | "closed";

const FINAL_CLOSE_CODES = new Set([4403, 4404, 4409, 4410, 4413]);

function browserId(): string {
  let id = localStorage.getItem("toasty:cid");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("toasty:cid", id);
  }
  return id;
}

export class MeetingSocket {
  private ws: WebSocket | null = null;
  private retry = 0;
  private stopped = false;
  private reconnectTimer: number | null = null;
  private statusTimer: number | null = null;

  constructor(
    private roomId: string,
    private name: string,
    private onMessage: (m: any) => void,
    private onStatus: (s: SocketStatus, reason?: string) => void,
  ) {}

  connect() {
    this.cleanupTimers();

    const enc = encodeURIComponent;
    const token = localStorage.getItem(hostTokenKey(this.roomId)) ?? "";

    // Force WSS on HTTPS pages (fixes Cloudflare tunnel drops)
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${location.host}/ws/${this.roomId}?name=${enc(this.name)}&token=${enc(token)}&cid=${enc(browserId())}`;

    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.onStatus("online"); // Immediately show "Connected"
    };

    ws.onmessage = (e) => {
      let m: any;
      try { m = JSON.parse(e.data); } catch { return; }

      // Reply to server heartbeat to keep Cloudflare tunnel alive
      if (m.type === "ping") {
        this.send({ type: "pong" });
        return;
      }

      if (m.type === "welcome") { this.retry = 0; this.onStatus("online"); }
      this.onMessage(m);
    };

    ws.onclose = (e) => {
      if (this.stopped) return;
      if (FINAL_CLOSE_CODES.has(e.code)) return this.onStatus("closed", e.reason);

      this.retry++;

      // Wait 2 seconds before showing "Reconnecting..." to the user.
      // If it reconnects faster than 2 seconds, they never see the error!
      this.statusTimer = window.setTimeout(() => {
        this.onStatus("reconnecting");
      }, 2000);

      this.reconnectTimer = window.setTimeout(() => {
        if (!this.stopped) this.connect();
      }, Math.min(1000 * this.retry, 5000));
    };
  }

  send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.stopped = true;
    this.cleanupTimers();
    this.ws?.close();
  }

  private cleanupTimers() {
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    if (this.statusTimer !== null) window.clearTimeout(this.statusTimer);
  }
}
