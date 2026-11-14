// @ts-check
// Shipify chat: a file you add to the box (compose.js), loaded the first time you add one, so the
// first screen doesn't carry it: a photo made smaller, then each sent up with its progress.
import { api, fail, h, size } from "./compose.js";

/** What the page lends (app.js `lazy`): nothing needed. */
export const init = () => {};

/**
 * A file just put in the box (Send waits on it from then): made smaller if a photo, then sent up.
 * `b` is the box (compose.js): `has`, `drop`, `draw`, `say`, `signin`, `m` and `task`.
 */
export async function add(it, b) {
  const f = await shrink(it.file);
  const most = b.m().files.bytes;
  if (!b.has(it)) return;
  if (f.size > most) {
    b.say(`${f.name} is over ${size(most)}.`);
    return b.drop(it);
  }
  if (/^(audio|video)\//.test(f.type)) b.say("A run can't listen to or watch this.");
  const url = /^image\//.test(f.type) && URL.createObjectURL(f);
  Object.assign(it, { file: f, name: f.name, type: f.type, size: f.size, url });
  put(it, b);
}

/** Sent up, or again on Retry. Failed offline: sent again once, by itself, when it's back online. */
export function put(it, b) {
  if (!b.has(it)) return;
  // Its bar moves where it is: the tray isn't drawn again for each step.
  const u = upload(it.file, b.task, (p) => {
    it.p = p;
    if (it.bar) it.bar.value = p;
  });
  Object.assign(it, { err: "", p: 0, abort: u.abort });
  const no = (e) => {
    it.err = `${e.message}: ${e.fix}`;
    // Access's sign-in ended: the bar at the top says so, as for a message.
    if (e.signin) b.signin();
    else if (e.off && b.has(it))
      addEventListener("online", () => it.err && put(it, b), { once: true });
  };
  u.p.then((r) => Object.assign(it, r), no).finally(b.draw);
  b.draw();
}

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
    // XHR follows Access's redirect to its sign-in and fails as if offline. With the network up,
    // the edge is asked once as api() asks (a redirect not followed): a sign-in ended says so.
    x.onerror = async () => {
      const a = navigator.onLine !== false && (await api("menu", 0, "").catch((e) => e));
      no(a?.signin ? a : fail(null, true));
    };
    x.onabort = () => no(fail(null, true));
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
