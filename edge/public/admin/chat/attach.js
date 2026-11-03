// @ts-check
// Shipify chat: a file you add to the box (compose.js), loaded the first time you add one, so the
// first screen doesn't carry it: a photo made smaller, then each sent up with its progress.
import { fail, h } from "./compose.js";

/** What the page lends (app.js `lazy`): nothing needed. */
export const init = () => {};

// With the open chat's number: a new chat's files get it when the door opens the chat.
export function upload(f, task, onp) {
  const x = new XMLHttpRequest();
  const p = new Promise((ok, no) => {
    x.open("POST", "api/file");
    x.responseType = "json";
    x.setRequestHeader("x-shipify-chat", "1");
    x.setRequestHeader("content-type", f.type || "application/octet-stream");
    x.setRequestHeader("x-file-name", encodeURIComponent(f.name));
    if (task) x.setRequestHeader("x-file-task", task);
    // A minute with nothing sent, or 2 minutes for its answer once it's sent whole: it fails, with
    // Retry. Never "Uploading…" for good.
    let wait;
    const give = (ms, error) => {
      clearTimeout(wait);
      wait = setTimeout(() => {
        no(fail({ error, fix: "Retry; words still go." }));
        x.abort();
      }, ms);
    };
    const moving = () => give(6e4, "Nothing was sent for a minute");
    x.upload.onprogress = (e) => moving() || onp(e.loaded / e.total);
    x.upload.onload = () => give(12e4, "The edge didn't answer in 2 minutes");
    x.onloadend = () => clearTimeout(wait);
    x.onload = () => (x.status < 300 && x.response?.ref ? ok(x.response) : no(fail(x.response)));
    x.onerror = () => no(fail(null, true));
    x.onabort = x.onerror;
    x.send(f);
    moving();
  });
  return { p, abort: () => x.abort() };
}

// A photo at most 2048px, the right way up, without EXIF or location; small PNGs as they are.
export async function shrink(f) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(f.type)) return f;
  try {
    const b = await createImageBitmap(f, { imageOrientation: "from-image" });
    const s = Math.min(1, 2048 / Math.max(b.width, b.height));
    if (f.type === "image/png" && s === 1) return f;
    const c = h("canvas", { width: Math.round(b.width * s), height: Math.round(b.height * s) });
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(b, 0, 0, c.width, c.height);
    const o = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
    return o ? new File([o], `${f.name.replace(/\.\w+$/, "")}.jpg`, { type: "image/jpeg" }) : f;
  } catch {
    return f;
  }
}
