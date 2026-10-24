// What a task's round takes in and gives out besides words: the owner's pasted images and linked
// files, and the files a run shares, on a side branch (ADR 0021).
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, sep } from "node:path";
import { gh, ghJson, ghRun, platformOwner, platformRepo } from "../../lib/github.ts";
import { maskSecrets } from "../../lib/safety.ts";
import { attachmentsIn, type Comment } from "../../lib/task.ts";
import { filesDir, type Issue, rec } from "./context.ts";

// ---------------------------------------------------------------- attachments

const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};
const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Files linked from the org's repos: as many, and up to GitHub's own limit for an attachment. */
const MAX_LINKED = 10;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** A file uploaded on GitHub, in an issue's or a comment's words. */
const ATTACHED = /github\.com\/(user-attachments\/|[^/\s]+\/[^/\s]+\/files\/\d)/;
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * What the owner gave a round: notes for the agent, and what no box can hand it (attached files,
 * and videos), which the reply names for the owner.
 */
export interface Given {
  notes: string[];
  unread: string[];
  videos: number;
}

/**
 * What the owner gave the task, for the agent: the images pasted into it and its comments, and
 * files linked from the org's repos (private ones too, with the bot's key). Images' signed links
 * last a few minutes, so this runs first in a round. Files attached to the issue can't be
 * downloaded by any key in a private repo (GitHub serves them to a signed-in browser only): the
 * reply names them, so the owner can link them instead.
 */
export async function taskAttachments(n: number, issue: Issue, owned: Comment[]): Promise<Given> {
  const texts = [issue.body ?? "", ...owned.map((c) => c.body)];
  const dir = filesDir(n);
  const given: Given = { notes: [], unread: [], videos: 0 };
  if (texts.some((b) => ATTACHED.test(b))) {
    const html = rec().rendered(n);
    const ids = new Set(owned.map((c) => c.id));
    Object.assign(
      given,
      await saveAttachments(dir, [
        { where: "in the description", html: html.body },
        ...html.comments
          .filter((c) => ids.has(c.id))
          .map((c) => ({ where: `in the comment of ${c.created_at}`, html: c.html })),
      ]),
    );
  } else {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }
  const linked = await saveLinkedFiles(dir, texts, platformOwner());
  given.notes.push(...linked);
  return given;
}

/**
 * The same for words a run takes in before it answers (ADR 0037): their pasted images, from one read
 * of the comments written since the run began (only when one has an upload), and their linked files,
 * saved beside the run's first ones. Notes for the agent.
 */
export async function laterAttachments(
  n: number,
  said: { id: number; text: string }[],
  since: string,
): Promise<string[]> {
  const dir = filesDir(n);
  const notes: string[] = [];
  if (said.some((c) => ATTACHED.test(c.text))) {
    const ids = new Set(said.map((c) => c.id));
    const html = rec({ timeoutMs: 20_000 }).rendered(n, since);
    const sources = html.comments
      .filter((c) => ids.has(c.id))
      .map((c) => ({ where: `in the comment of ${c.created_at}`, html: c.html }));
    notes.push(...(await saveAttachments(dir, sources, fetch, true)).notes);
  }
  const texts = said.map((c) => c.text);
  notes.push(...(await saveLinkedFiles(dir, texts, platformOwner())));
  return notes;
}

/**
 * Saves the newest images in `dir` (replacing the last round's; beside them for words a run takes
 * in before it answers: `later`) and says what's there.
 */
export async function saveAttachments(
  dir: string,
  sources: { where: string; html: string }[],
  get: Fetch = fetch,
  later = false,
): Promise<Given> {
  if (!later) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const found = sources.map((s) => ({ where: s.where, ...attachmentsIn(s.html) }));
  const images = found.flatMap((s) => s.images.map((url) => ({ where: s.where, url })));
  const files = [...new Set(found.flatMap((s) => s.files))];
  const videos = found.reduce((n, s) => n + s.videos, 0);
  const saved: string[] = [];
  let failed = 0;
  // Numbered on from the images already there: 1.png, 2.png…
  const had = readdirSync(dir).filter((f) => /^\d+\.\w+$/.test(f)).length;
  for (const [i, img] of images.slice(-MAX_IMAGES).entries()) {
    const got = await downloadImage(img.url, get);
    if (!got) {
      failed++;
      continue;
    }
    const file = freeFile(dir, `${had + i + 1}.${got.ext}`);
    writeFileSync(file, got.bytes);
    saved.push(`\`${file}\` (${img.where})`);
  }
  const notes: string[] = [];
  if (saved.length)
    notes.push(
      `The owner attached images, saved on this box. Look at each before you answer: ${saved.join(", ")}.`,
    );
  if (images.length > MAX_IMAGES)
    notes.push(`Only the newest ${MAX_IMAGES} of the ${images.length} images were saved.`);
  if (failed)
    notes.push(
      `${failed} image(s) couldn't be downloaded (not a picture, over 10 MB, or GitHub refused). If one matters, ask the owner to describe it.`,
    );
  // The reply says what couldn't be opened, and how to give it instead: the agent needn't, but for
  // words taken in later, which the reply never read.
  const told = later
    ? "Don't try to download it: say in your reply that it couldn't be opened, and ask for a link to it in one of the owner's repos (or a paste) instead."
    : "Don't try to download it, and don't mention it: the reply already tells the owner.";
  if (files.length)
    notes.push(
      `Attached to the task, and no key can download it (GitHub's rule for private repos): ${files.join(", ")}. ${told} If the ask can't be answered without it, say only that.`,
    );
  if (videos)
    notes.push(
      `The owner pasted ${videos === 1 ? "a video" : `${videos} videos`}, which you can't watch. ${told}`,
    );
  return { notes, unread: files, videos };
}

/**
 * A path in `dir` for `name` that no file there has yet: photo.jpg, then 2-photo.jpg, 3-photo.jpg…
 * Two files of one name (every Telegram photo is photo.jpg) are both kept.
 */
export function freeFile(dir: string, name: string): string {
  let file = join(dir, name);
  for (let i = 2; existsSync(file); i++) file = join(dir, `${i}-${name}`);
  return file;
}

/** A link to a file in a repo: https://github.com/<owner>/<repo>/blob/<ref>/<path>. */
const BLOB = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/blob\/([\w.-]+)\/([^\s)"'<>#?]+)/g;

/**
 * Files the owner linked from the org's own repos (a `.md`, a PDF, a CSV, private or not), saved in
 * `dir` with the bot's key, so the agent reads them as files. Links elsewhere are the agent's to
 * fetch (public pages, gists, raw links). Returns lines for the notes.
 */
export async function saveLinkedFiles(
  dir: string,
  texts: string[],
  org: string,
  get: Fetch = fetch,
  key = process.env.GH_TOKEN,
): Promise<string[]> {
  // A link ends where its sentence does: "see …/plan.md." is plan.md.
  const links = [
    ...new Map(
      texts
        .flatMap((t) => [...t.matchAll(BLOB)])
        .filter((m) => m[1]?.toLowerCase() === org.toLowerCase())
        .map((m) => {
          const url = (m[0] as string).replace(/[.,;:!]+$/, "");
          const path = (m[4] as string).replace(/[.,;:!]+$/, "");
          return [url, [url, m[1], m[2], m[3], path]] as const;
        }),
    ).values(),
  ].slice(-MAX_LINKED);
  if (!links.length) return [];
  if (!key)
    return [
      "The owner linked files in the org's repos, but this run has no bot key to read them: ask for the text if you need it.",
    ];
  mkdirSync(dir, { recursive: true });
  const saved: string[] = [];
  const failed: string[] = [];
  for (const m of links) {
    const [url, , repo, ref, path] = m as unknown as string[];
    try {
      const name = basename(decodeURIComponent(path as string));
      const res = await get(
        `https://api.github.com/repos/${org}/${repo}/contents/${path}?ref=${encodeURIComponent(ref as string)}`,
        {
          headers: { authorization: `Bearer ${key}`, accept: "application/vnd.github.raw" },
          signal: AbortSignal.timeout(60_000),
        },
      );
      const size = Number(res.headers.get("content-length") ?? 0);
      if (!res.ok || size > MAX_FILE_BYTES)
        throw new Error(res.ok ? "over 25 MB" : `HTTP ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > MAX_FILE_BYTES) throw new Error("over 25 MB");
      const file = freeFile(dir, name);
      writeFileSync(file, bytes);
      saved.push(`\`${file}\` (from ${url})`);
    } catch (e) {
      failed.push(`${url} (${(e as Error).message})`);
    }
  }
  const notes: string[] = [];
  if (saved.length)
    notes.push(`The owner linked files, saved on this box. Read each: ${saved.join(", ")}.`);
  if (failed.length) notes.push(`These linked files couldn't be read: ${failed.join(", ")}.`);
  return notes;
}

async function downloadImage(
  url: string,
  get: Fetch,
): Promise<{ bytes: Buffer; ext: string } | undefined> {
  try {
    const res = await get(url, { signal: AbortSignal.timeout(30_000) });
    const ext = IMAGE_TYPES[(res.headers.get("content-type") ?? "").replace(/;.*/, "").trim()];
    if (!res.ok || !ext || Number(res.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES)
      return undefined;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length > MAX_IMAGE_BYTES ? undefined : { bytes, ext };
  } catch {
    return undefined;
  }
}

/**
 * Files onto a side branch of a repo (its own history, never merged), so they stay as private as
 * the repo and cost nothing: a task's files on Shipify's `shipify-files`. One commit per round into its own folder, with no issue reference in
 * it, so the task's timeline stays clean. Two rounds can finish at once (ADR 0020): a branch that
 * moved meanwhile is read again, up to three times. Returns each file's link, by its path here.
 */
export function publishToBranch(
  repo: string,
  branch: string,
  folder: string,
  files: string[],
  message: string,
): Map<string, { view: string; raw: string }> {
  const post = <T>(path: string, body: unknown) =>
    ghJson<T>(["api", "-X", "POST", `repos/${repo}/${path}`, "--input", "-"], {
      input: JSON.stringify(body),
    });
  const tipOf = () => {
    const tip = ghRun(["api", `repos/${repo}/git/ref/heads/${branch}`, "--jq", ".object.sha"]);
    return tip.code === 0 ? tip.stdout.trim() : undefined;
  };
  const parent = tipOf();
  // One name each in the folder: a second chart.png is 2-chart.png.
  const used = new Set<string>();
  const named = files.map((f) => {
    let name = basename(f);
    for (let i = 2; used.has(name); i++) name = `${i}-${basename(f)}`;
    used.add(name);
    return { file: f, path: `${folder}/${name}` };
  });
  const tree = named.map(({ file, path }) => ({
    path,
    mode: "100644",
    type: "blob",
    sha: post<{ sha: string }>("git/blobs", {
      content: readFileSync(file).toString("base64"),
      encoding: "base64",
    }).sha,
  }));
  const commitOn = (parent: string | undefined) => {
    const baseTree = parent
      ? gh(["api", `repos/${repo}/git/commits/${parent}`, "--jq", ".tree.sha"]).trim()
      : undefined;
    const treeSha = post<{ sha: string }>("git/trees", {
      ...(baseTree ? { base_tree: baseTree } : {}),
      tree,
    }).sha;
    const commit = post<{ sha: string }>("git/commits", {
      message,
      tree: treeSha,
      parents: parent ? [parent] : [],
    }).sha;
    if (parent)
      ghJson(["api", "-X", "PATCH", `repos/${repo}/git/refs/heads/${branch}`, "--input", "-"], {
        input: JSON.stringify({ sha: commit }),
      });
    else post("git/refs", { ref: `refs/heads/${branch}`, sha: commit });
  };
  for (let attempt = 1; ; attempt++) {
    const now = attempt === 1 ? parent : tipOf();
    try {
      commitOn(now);
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
    }
  }
  const at = (path: string) => `https://github.com/${repo}/blob/${branch}/${path}`;
  return new Map(
    named.map(({ file, path }) => [file, { view: at(path), raw: `${at(path)}?raw=true` }]),
  );
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

const SHOWN = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const MAX_MADE_BYTES = 25 * 1024 * 1024;

/**
 * The files a run made for the owner (its result's `files`), checked: each must be a file in the
 * task's own files folder (a link out of it, or anything elsewhere on the box, is refused), and
 * 25 MB at most. Returns the ones to publish, and notes for the rest.
 */
export function madeFiles(dir: string, paths: string[]): { files: string[]; notes: string[] } {
  const files: string[] = [];
  const notes: string[] = [];
  let root: string;
  try {
    root = realpathSync(dir);
  } catch {
    return {
      files,
      notes: paths.length ? ["The files folder is missing, so no files were shared."] : [],
    };
  }
  for (const p of paths) {
    try {
      const real = realpathSync(p.startsWith("/") ? p : join(dir, p));
      if (!real.startsWith(`${root}${sep}`)) throw new Error("not in the task's files folder");
      const st = statSync(real);
      if (!st.isFile()) throw new Error("not a file");
      if (st.size > MAX_MADE_BYTES) throw new Error("over 25 MB");
      if (!files.includes(real)) files.push(real);
    } catch (e) {
      notes.push(
        `Not shared: ${basename(p)} (${(e as Error).message.replace(/^ENOENT.*/, "not found")}).`,
      );
    }
  }
  return { files, notes };
}

/** Files read as text, so anything like a key is hidden in them before they're shared. */
const TEXT = new Set([
  ".md",
  ".txt",
  ".csv",
  ".tsv",
  ".json",
  ".jsonl",
  ".log",
  ".yml",
  ".yaml",
  ".html",
  ".xml",
  ".sql",
  ".svg",
  ".ts",
  ".js",
  ".mjs",
  ".py",
  ".sh",
  ".toml",
  ".ini",
  ".env",
]);

/** A file's content hash, as a task's status keeps it for each file it shared (`shared`). */
export const fileHash = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 16);

/**
 * A run's files on Shipify's `shipify-files` branch: images shown, the rest linked, as markdown,
 * and each file's link by its path here.
 */
export function publishMade(
  n: number,
  files: string[],
): { text: string; links: Map<string, string> } {
  if (!files.length) return { text: "", links: new Map() };
  for (const f of files)
    if (TEXT.has(extname(f).toLowerCase())) writeFileSync(f, maskSecrets(readFileSync(f, "utf8")));
  const urls = publishToBranch(
    platformRepo(),
    "shipify-files",
    `task-${n}/${stamp()}`,
    files,
    `Files for task ${n}`,
  );
  const lines = files.map((f) => {
    const u = urls.get(f);
    const name = basename(f).replace(/[[\]]/g, "");
    if (!u) return "";
    return SHOWN.has(extname(f).toLowerCase()) ? `![${name}](${u.raw})` : `- [${name}](${u.view})`;
  });
  return {
    text: ["**Files:**", ...lines.filter(Boolean)].join("\n"),
    links: new Map([...urls].map(([f, u]) => [f, u.view])),
  };
}
