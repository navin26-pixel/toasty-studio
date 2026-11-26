import { h } from "../ui/dom";

/**
 * BACKEND INTEGRATION POINT: media library.
 * Nothing here is saved or shared. Uploading, listing and sharing files needs server-side storage and
 * endpoints that do not exist yet. When they do, replace each empty section with a list and enable Upload.
 */
const SECTIONS = [
  { title: "Uploaded media", hint: "Files you upload for this session." },
  { title: "Audio files", hint: "Intros, outros, music beds and sound effects." },
  { title: "Video files", hint: "Clips to play or reference during the session." },
  { title: "Shared assets", hint: "Images and documents shared with the whole session." },
];

export function createMediaTab(): HTMLElement {
  const root = h("div", "media-tab");
  root.append(h("p", "ws-help", "The media library is a preview. Uploading and sharing files is not available yet."));
  for (const s of SECTIONS) {
    const sec = h("section", "media-section");
    const head = h("header");
    head.append(h("h3", "", s.title), h("span", "soon-badge", "Coming soon"));
    const upload = h("button", "ctl mini", "Upload", { type: "button" });
    upload.disabled = true;
    upload.title = "Needs backend storage";
    sec.append(head, h("p", "", s.hint), upload);
    root.append(sec);
  }
  return root;
}