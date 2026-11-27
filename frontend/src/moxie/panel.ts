import { h } from "../ui/dom";
import { icon } from "../media/controls";
import { moxieService } from "./moxie-service";

const SUGGESTIONS = [
  "Suggest discussion topics for this session",
  "Summarize our conversation so far",
  "Draft an intro for this episode",
  "What should I ask next?",
];

export function createMoxiePanel(onClose: () => void): HTMLElement {
  const service = moxieService;
  const root = h("div", "moxie");

  const head = h("div", "moxie-head");
  const mark = h("span", "moxie-mark");
  mark.innerHTML = icon.spark;
  const close = h("button", "icon-btn", "", { type: "button", "aria-label": "Close Moxie" });
  close.innerHTML = icon.close;
  close.onclick = onClose;
  head.append(mark, h("strong", "", "Moxie AI"), h("span", "soon-badge", "Coming soon"), close);

  const log = h("div", "moxie-log", "", { role: "log", "aria-live": "polite" });
  const empty = h("div", "moxie-empty");
  empty.append(
    h("p", "moxie-title", "Research and prep, right in the session"),
    h("p", "ws-help", "Moxie will help you research topics, follow the conversation and prepare discussion points. It is not connected yet."),
  );
  const chips = h("div", "moxie-chips");
  empty.append(chips);
  log.append(empty);

  const form = h("form", "moxie-form");
  const input = h("input", "", "", { type: "text", placeholder: "Ask Moxie", "aria-label": "Message Moxie", maxlength: "500" });
  const send = h("button", "ctl primary", "Send", { type: "submit" });
  form.append(input, send);
  const note = h("p", "ws-help", service ? "" : "Moxie is not connected yet. Nothing you type here is sent anywhere.");

  for (const text of SUGGESTIONS) {
    const chip = h("button", "moxie-chip", text, { type: "button" });
    chip.onclick = () => { input.value = text; input.focus(); };
    chips.append(chip);
  }

  if (!service) {
    send.disabled = true;
    send.title = "Moxie is coming soon";
  }

  function addMessage(from: "you" | "moxie", text: string) {
    empty.remove();
    const m = h("div", "moxie-msg", text);
    m.dataset.from = from;
    log.append(m);
    log.scrollTop = log.scrollHeight;
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!service || !text) return;
    addMessage("you", text);
    input.value = "";
    send.disabled = true;
    try {
      addMessage("moxie", await service.ask(text));
    } catch {
      addMessage("moxie", "Moxie could not answer. Try again.");
    } finally {
      send.disabled = false;
    }
  };

  root.append(head, log, form, note);
  return root;
}