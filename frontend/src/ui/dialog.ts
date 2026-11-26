export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Destructive actions are styled red and start with focus on Cancel. */
  danger?: boolean;
};

let counter = 0;

/** Resolves true only when the person presses the confirm button. Escape, Cancel and a backdrop click resolve false. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const id = `confirm-${++counter}`;
    const dialog = document.createElement("dialog");
    dialog.className = "confirm";
    dialog.setAttribute("aria-labelledby", `${id}-title`);
    dialog.setAttribute("aria-describedby", `${id}-text`);

    const title = document.createElement("h2");
    title.id = `${id}-title`;
    title.textContent = opts.title;

    const text = document.createElement("p");
    text.id = `${id}-text`;
    text.textContent = opts.message;

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ctl";
    cancel.textContent = opts.cancelLabel ?? "Cancel";
    cancel.onclick = () => dialog.close("cancel");

    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "ctl " + (opts.danger ? "danger" : "primary");
    confirm.textContent = opts.confirmLabel;
    confirm.onclick = () => dialog.close("confirm");

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(cancel, confirm);

    dialog.append(title, text, actions);
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close("cancel"); });
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "confirm");
      dialog.remove();
    }, { once: true });

    document.body.append(dialog);
    dialog.showModal();
    (opts.danger ? cancel : confirm).focus();
  });
}