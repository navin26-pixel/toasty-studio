import { getReport } from "../services/api";
import type { HostActions } from "../participants/panel";

/** Host requests. The server checks the sender's role on every one, so these only ask. */
export function hostActions(send: (m: object) => void): HostActions & { end(): void } {
  return {
    remove: (target) => { if (confirm("Remove this person from the meeting?")) send({ type: "host", action: "remove", target }); },
    mute: (target) => send({ type: "host", action: "mute", target }),
    allowShare: (target, value) => send({ type: "host", action: "allow-share", target, value }),
    end: () => send({ type: "host", action: "end" }),
  };
}

export async function askLeave(): Promise<"leave" | "end" | "cancel"> {
  const dialog = document.getElementById("leaveDialog") as HTMLDialogElement;
  dialog.returnValue = "cancel";
  dialog.showModal();
  await new Promise((done) => dialog.addEventListener("close", done, { once: true }));
  return dialog.returnValue as "leave" | "end" | "cancel";
}

/** Shows who spoke and who attended. Returns false when the server refuses (not the host). */
export async function showReport(roomId: string): Promise<boolean> {
  const data = await getReport(roomId);
  if (!data) return false;
  const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  const at = (ms: number | null) => (ms ? new Date(ms).toLocaleTimeString() : "still in the meeting");
  const lines = ["Who spoke (total time, turns)"];
  for (const s of data.speakers) lines.push(`${s.name}: ${mmss(s.speakingMs)}, ${s.turns} turns`);
  lines.push("", "Who was in the meeting");
  for (const p of data.participants) lines.push(`${p.name} (${p.role}): joined ${at(p.joinedAt)}, left ${at(p.leftAt)}`);
  document.getElementById("reportBody")!.textContent = lines.join("\n");
  document.getElementById("reportDownload")!.onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = `toasty-${roomId}-speakers.json`;
    a.click();
  };
  (document.getElementById("reportDialog") as HTMLDialogElement).showModal();
  return true;
}