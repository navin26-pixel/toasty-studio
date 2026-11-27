import { h } from "../ui/dom";
import { avatar, type PeerState } from "../participants/panel";

export function openAssignDialog(opts: {
  people: () => PeerState[];
  isProducer: (id: string) => boolean;
  setProducer: (id: string, on: boolean) => void;
}) {
  const dialog = h("dialog", "invite");
  const list = h("div", "assign-list");
  const done = h("button", "ctl primary", "Done", { type: "button" });
  done.onclick = () => dialog.close();
  const actions = h("div", "actions");
  actions.append(done);

  function render() {
    list.replaceChildren();
    const people = opts.people();
    if (!people.length) {
      list.append(h("p", "muted", "No one else is in the meeting yet. Invite someone first."));
      return;
    }
    for (const p of people) {
      const on = opts.isProducer(p.id);
      const row = h("div", "assign-row");
      const btn = h("button", "ctl mini" + (on ? "" : " primary"), on ? "Remove producer" : "Make producer", { type: "button" });
      btn.onclick = () => { opts.setProducer(p.id, !on); render(); };
      row.append(avatar(p.name), h("strong", "", p.name), btn);
      list.append(row);
    }
  }

  render();
  dialog.append(
    h("h2", "", "Assign producer"),
    h("p", "muted", "Pick someone in this meeting. Producers get the production tools and can ask people to mute. They cannot remove people or change sharing permissions."),
    list,
    actions,
  );
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}