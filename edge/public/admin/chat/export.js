// @ts-check
// Shipify chat: Export (ADR 0069), loaded the first time it's used. Your browser builds the zip
// from what the page reads already (a project's thread, its pages and chats, the files kept): no
// run, no write, nothing kept anywhere but your device. A zip as a drop is yours to attach and ask
// for ("share this as a drop").

import { h, icon, pop, size } from "./compose.js";

/** What the page lends (app.js `lazy`): its state, for an upload's limit. @type {any} */
let A;
export const init = (a) => {
  A = a;
};

const enc = new TextEncoder();
/** A read of the chat's own, always whole (no ETag: an export wants the body). */
const read = (p) =>
  fetch(`api/${p}`, { headers: { "x-shipify-chat": "1" } }).then((r) =>
    r.ok ? r : Promise.reject(new Error(`${p}: ${r.status}`)),
  );
const json = (p) => read(p).then((r) => r.json());
/** A thread whole: its newest page, then each older one to the first, as Earlier messages reads. */
async function whole(n) {
  const t = await json(`task/${n}`);
  for (let p = t.page - 1, d = t; d.earlier && p > 0; p--) {
    d = await json(`task/${n}?page=${p}`);
    t.messages = [...d.messages, ...t.messages];
  }
  return t;
}
/**
 * The zip is built in this device's memory: past 50 MB of files, their size is said before any is
 * read, and you may stop (no alert then: offer says nothing for an error with no words).
 */
function sure(files) {
  const b = files.reduce((s, f) => s + (f.size || 0), 0);
  if (b > 5e7 && !confirm(`Its files come to ${size(b)}: build the zip on this device?`))
    throw Error("");
}

let table;
function crc(b) {
  table ||= Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  let c = ~0;
  for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}

/**
 * Deflated with the browser's own stream (no library); stored when that's not smaller, or when the
 * browser has none (an older one).
 */
async function deflate(b) {
  try {
    const s = new Blob([b]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const d = new Uint8Array(await new Response(s).arrayBuffer());
    if (d.length < b.length) return [8, d];
  } catch {}
  return [0, b];
}

/** A part of a name in the zip, safe to unpack anywhere: no slash, control character or `..`. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it takes out.
const part = (s) => `${s}`.replace(/[\0-\x1f\x7f/\\:*?"<>|]/g, "_").replace(/^\.*$/, "_");

/**
 * A zip of these files ([name, bytes]): local headers, then the central directory. Each name safe,
 * and once: a second `a.png` (by any case) is `a (2).png`.
 */
export async function zip(files) {
  const parts = [];
  const dir = [];
  const seen = new Set();
  let at = 0;
  for (const [path, bytes] of files) {
    const safe = path.split("/").map(part).join("/");
    let name = safe;
    for (let i = 2; seen.has(name.toLowerCase()); i++)
      name = safe.replace(/(\.[^./]*)?$/, ` (${i})$1`);
    seen.add(name.toLowerCase());
    const n = enc.encode(name);
    const [method, data] = await deflate(bytes);
    const head = (sig, extra) => {
      const v = new DataView(new ArrayBuffer(extra ? 46 : 30));
      v.setUint32(0, sig, true);
      // The central directory's entry says which version made it, then as the local header does.
      if (extra) v.setUint16(4, 20, true);
      let o = extra ? 6 : 4;
      for (const [x, w] of [
        [20, 2],
        [0x800, 2],
        [method, 2],
        [0, 4],
        [crc(bytes), 4],
        [data.length, 4],
        [bytes.length, 4],
        [n.length, 2],
        [0, 2],
      ]) {
        if (w === 2) v.setUint16(o, x, true);
        else v.setUint32(o, x, true);
        o += w;
      }
      if (extra) v.setUint32(42, at, true);
      return new Uint8Array(v.buffer);
    };
    parts.push(head(0x04034b50), n, data);
    dir.push(head(0x02014b50, true), n);
    at += 30 + n.length + data.length;
  }
  const size = dir.reduce((s, d) => s + d.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, at, true);
  return new Blob([...parts, ...dir, end], { type: "application/zip" });
}

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50) || "x";
/** A thread as Markdown: each message with who and when. */
const asMd = (t) =>
  [
    `# #${t.task.n} ${t.task.title}`,
    "",
    ...t.messages.map((m) => `## ${m.who}, ${m.at}\n\n${m.md}\n`),
  ].join("\n");

/**
 * A project's zip: README.md, ALL.md (one file for another agent), pages/, inbox.md, chats/ (when
 * asked), files/ and project.json (the same as a list, for a script). Each thread read whole; a
 * big one's size said first.
 */
export async function exportProject(n, withChats = true) {
  const p = await whole(n);
  const pr = p.task.project;
  if (!pr) throw new Error(`#${n} isn't a project`);
  const own = new Set([n, ...pr.chats.map((c) => c.n), ...pr.pages.map((g) => g.n)]);
  const files = ((await json("files")).files || []).filter((f) => own.has(f.task));
  sure(files);
  const root = part(pr.name);
  const out = [];
  const add = (name, text) => out.push([`${root}/${name}`, enc.encode(text)]);
  const pages = [];
  for (const g of pr.pages) {
    const t = await whole(g.n);
    pages.push({ ...g, md: t.messages[0]?.md ?? "", items: t.messages.slice(1) });
  }
  const chats = withChats ? await Promise.all(pr.chats.map((c) => whole(c.n))) : [];
  const inbox = pages.find((g) => g.topic === `${pr.name}-inbox`);
  const brief = p.messages[0]?.md ?? "";
  for (const g of pages) if (g !== inbox) add(`pages/${slug(g.topic)}.md`, g.md);
  const items = inbox ? inbox.items.map((m) => `- ${m.at}: ${m.md.replace(/\n+/g, " ")}`) : [];
  if (inbox) add("inbox.md", `# ${pr.name}: Inbox\n\n${items.join("\n")}\n`);
  for (const t of chats) add(`chats/${t.task.n}-${slug(t.task.title)}.md`, asMd(t));
  const readme = `# ${pr.name}\n\nExported ${new Date().toISOString()} from Shipify (#${n}).\n\n${brief}\n\n- pages/: the project's pages\n- inbox.md: its Inbox\n- chats/: each chat, whole\n- files/: its files\n- ALL.md: everything in one file\n- project.json: the same, as a list\n`;
  add("README.md", readme);
  add(
    "ALL.md",
    [
      readme,
      ...pages.filter((g) => g !== inbox).map((g) => `\n# Page: ${g.topic}\n\n${g.md}`),
      items.length ? `\n# Inbox\n\n${items.join("\n")}` : "",
      ...chats.map((t) => `\n${asMd(t)}`),
    ].join("\n"),
  );
  for (const f of files)
    out.push([
      `${root}/files/${f.task}-${part(f.name)}`,
      new Uint8Array(await (await read(`file/${f.ref}?download=1`)).arrayBuffer()),
    ]);
  add(
    "project.json",
    JSON.stringify(
      {
        name: pr.name,
        n,
        brief,
        pages: pages.map(({ n, topic, url }) => ({ n, topic, url })),
        chats: pr.chats,
        files: files.map(({ ref, name, size, task }) => ({ ref, name, size, task })),
      },
      null,
      2,
    ),
  );
  return { blob: await zip(out), name: `${root}.zip` };
}

/** Everything kept in the web chat's files, as one zip: Files' **Export everything**. */
export async function exportFiles() {
  const files = (await json("files")).files || [];
  sure(files);
  const out = [];
  for (const f of files)
    out.push([
      `files/${f.task || "no-chat"}/${part(f.name)}`,
      new Uint8Array(await (await read(`file/${f.ref}?download=1`)).arrayBuffer()),
    ]);
  return { blob: await zip(out), name: "shipify-files.zip" };
}

/** Saves a zip on this device, through the browser's own download. */
export function save({ blob, name }) {
  const a = h("a", { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 6e4);
}

/**
 * A zip being made, its size said first once it's built (ADR 0069): then Download, or (one upload's
 * limit at most: the menu's, else the edge's 95 MB) Share as a drop, which hands `share` the zip as
 * a file for a box.
 */
export async function offer(at, made, share) {
  at.disabled = true;
  const z = await made.catch((e) => e.message && alert(`It couldn't be exported: ${e.message}`));
  at.disabled = false;
  if (!z) return;
  const file = () => share(new File([z.blob], z.name, { type: "application/zip" }));
  pop(at, [
    `${z.name} · ${size(z.blob.size)}`,
    [[icon("save"), "Download"], () => save(z)],
    z.blob.size <= (A?.S.menu?.files?.bytes || 95e6) && [[icon("open"), "Share as a drop"], file],
  ]);
}
