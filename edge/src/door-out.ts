// The door's way out (ADR 0031, "The door: out"): POST /door/replied. Right after a run writes a
// reply, its apply step calls here with the comment's number, the files it made (multipart, up to
// 10, 10 MB each) and its GitHub OIDC token. The door checks the token, then the comment: written
// by a run (github-actions[bot]), with a reply line, not edited by anyone else, and with no 🚀 of
// the door App's yet. It sends the reply's words to each chat in `to` that belongs to a person in
// SHIPIFY_PEOPLE, through that chat's channel adapter (ADR 0032), each once, then marks it as the
// door App, visible on GitHub (ADR 0042): 🚀 "it reached every chat it was for" (a chat that reads
// replies in place has it already), or 😕 when none could take it. Then the files, so a slow upload
// can't make sent words look unsent; any that didn't go are said in one short message. A chat that
// didn't confirm the words leaves no mark: the watch's one notice covers it. One that can't be
// reached gets one alert on the status task; one that refused what Shipify made is told so at once.
// Nothing is sent twice.
import {
  type Findings,
  plural,
  problem,
  readReply,
  withoutLine,
} from "../../cli/contracts/index.ts";
import { emptyFindings, sayFindings } from "./alerts.ts";
import { MAX_FILE_BYTES, type Outgoing as Out } from "./channels/channel.ts";
import { channelOf } from "./channels/index.ts";
import { alertOf, outgoingOf } from "./chat.ts";
import type { Deps, Env } from "./env.ts";
import { GITHUB_NEEDS, json, logOf, missing, OIDC_NEEDS, unconfigured } from "./env.ts";
import {
  appLogin,
  byRun,
  DoorKeyRefused,
  type GitHub,
  github,
  issueOf,
  passing,
} from "./github.ts";
import { bearer, verifyRun } from "./oidc.ts";
import {
  type Chat,
  chatsIn,
  type Person,
  personOf,
  runners,
  settings,
  statusTask,
  toBoxes,
} from "./settings.ts";

const MAX_FILES = 10;
const MAX_BODY_BYTES = MAX_FILES * MAX_FILE_BYTES + 256 * 1024;

/** What a run hands the door: the task, its reply's comment, and the files it made. */
export interface Outgoing {
  task: number;
  comment: number;
  files: File[];
}

const positive = (v: unknown) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
};

/** The request's task, comment and files, or why it isn't one (and its status). */
export async function readOutgoing(
  req: Request,
): Promise<Outgoing | { why: string; status: 400 | 413 }> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES)
    return { why: "too big", status: 413 };
  let task = 0;
  let comment = 0;
  let files: File[] = [];
  try {
    if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const form = await req.formData();
      task = positive(form.get("task"));
      comment = positive(form.get("comment"));
      files = form.getAll("file").filter((f): f is File => typeof f !== "string");
    } else {
      const body = (await req.json()) as { task?: unknown; comment?: unknown };
      task = positive(body?.task);
      comment = positive(body?.comment);
    }
  } catch {
    return { why: "not a reply's call", status: 400 };
  }
  if (!task || !comment) return { why: "task and comment are numbers", status: 400 };
  if (files.length > MAX_FILES) return { why: `${MAX_FILES} files at most`, status: 413 };
  if (files.some((f) => f.size > MAX_FILE_BYTES))
    return { why: "10 MB a file at most", status: 413 };
  return { task, comment, files };
}

/** How a reply's words went, chat by chat: each tried once. */
export interface Delivery {
  /** Chats that took them. */
  sent: Chat[];
  /** Chats that can't be reached (blocked, gone), with the channel's words. */
  refused: { chat: Chat; answer: string }[];
  /** Chats that refused them as Shipify made them (its bug), with the channel's words. */
  wrong: { chat: Chat; answer: string }[];
  /** Chats that didn't confirm them (busy, down, no answer in time). */
  unconfirmed: Chat[];
}

/** Whether a channel has its secrets in this Worker. */
export const ready = (env: Env, channel: string) => {
  const ch = channelOf(channel);
  return ch !== undefined && missing(env, ch.needs).length === 0;
};

/** A reply's words to each of its chats that pushes (one that reads in place has them), once. */
export async function deliver(env: Env, deps: Deps, chats: Chat[], out: Out): Promise<Delivery> {
  const d: Delivery = { sent: [], refused: [], wrong: [], unconfirmed: [] };
  for (const c of chats) {
    const ch = channelOf(c.channel);
    if (!ch || ch.inPlace) continue;
    const sent = await ch.send(env, deps, c.chat, out);
    if (sent.ok) d.sent.push(c);
    else if ("refused" in sent) d.refused.push({ chat: c, answer: sent.refused });
    else if ("rendering" in sent) d.wrong.push({ chat: c, answer: sent.rendering });
    else d.unconfirmed.push(c);
  }
  return d;
}

/** Whether the door App has marked this comment with this reaction already. */
async function markedBy(gh: GitHub, login: string, comment: number, content: string) {
  const list = await gh.json<{ user?: { login?: string; type?: string } }[]>(
    "GET",
    `repos/${gh.repo}/issues/comments/${comment}/reactions?content=${content}&per_page=100`,
  );
  return list.some((r) => r.user?.login === login && r.user?.type === "Bot");
}

/** The door App's reaction on a comment: 🚀 reached, 😕 given up (told another way). */
export const react = (gh: GitHub, comment: number, content: "rocket" | "confused") =>
  gh.json("POST", `repos/${gh.repo}/issues/comments/${comment}/reactions`, { content });

/** Notes for the status task, said once, then its alert run rung (on a box when one is online). */
async function alert(gh: GitHub, deps: Deps, notes: Findings["notes"]) {
  if (!notes.length) return;
  const status = await statusTask(gh);
  if (!status) return;
  const online = await runners(gh, deps.now(), 30_000)
    .then((l) => toBoxes(l).some((b) => b.online))
    .catch(() => false);
  await sayFindings(gh, status, { ...emptyFindings(), notes }, online);
}

/** The channels' names, for people: "Telegram". */
export const namesOf = (chats: { channel: string }[]) =>
  [...new Set(chats.map((c) => channelOf(c.channel)?.name ?? c.channel))].join(", ");

/**
 * Whether a run's comment can be trusted as written: never edited, or edited only by a run. REST
 * can't say who edited, so an edited one is asked of GraphQL.
 */
export async function unedited(
  gh: GitHub,
  c: { node_id?: string; created_at: string; updated_at?: string },
) {
  if (!c.updated_at || c.updated_at === c.created_at) return true;
  const data = await gh.graphql<{
    node?: { lastEditedAt?: string | null; editor?: { login?: string } | null } | null;
  }>(
    "query($id: ID!) { node(id: $id) { ... on IssueComment { lastEditedAt editor { login } } } }",
    {
      id: c.node_id ?? "",
    },
  );
  const editor = data.node?.editor?.login;
  return (
    !data.node?.lastEditedAt || editor === "github-actions" || editor === "github-actions[bot]"
  );
}

export interface RunComment {
  id: number;
  node_id?: string;
  html_url: string;
  issue_url?: string;
  body?: string | null;
  user?: { login?: string; id?: number } | null;
  performed_via_github_app?: { id?: number } | null;
  created_at: string;
  updated_at?: string;
  reactions?: { rocket?: number; confused?: number };
}

export async function replied(req: Request, env: Env, deps: Deps): Promise<Response> {
  const log = logOf(deps, "door.out");
  const gone = missing(env, [...GITHUB_NEEDS, ...OIDC_NEEDS]);
  if (gone.length) return unconfigured(log, gone);
  const token = bearer(req);
  const verdict = token
    ? await verifyRun(token, env, deps)
    : { ok: false as const, why: "no token" };
  if (!verdict.ok) {
    log.warn("door.out.failed", { why: `unproven: ${verdict.why}` });
    return json({ error: "unproven", why: verdict.why }, 401);
  }
  const out = await readOutgoing(req);
  if ("why" in out) return json({ error: out.why }, out.status);
  const gh = github(env, deps);
  try {
    const s = await settings(gh, deps.now());
    if (s.closed) return json({ door: "closed" }, 503);
    const got = await gh.call("GET", `repos/${gh.repo}/issues/comments/${out.comment}`);
    if (got.status === 404) return json({ error: "no such comment" }, 404);
    if (got.status !== 200) return json({ error: `GitHub answered ${got.status}` }, 503);
    const c = got.data as RunComment;
    const reply = readReply(c.body);
    if (!byRun(c) || issueOf(c.issue_url) !== out.task || !reply) {
      log.warn("door.out.failed", { task: out.task, why: "not a run's reply" });
      return json({ error: "not a run's reply on that task" }, 409);
    }
    if (!(await unedited(gh, c))) {
      log.warn("door.out.failed", { task: out.task, why: "edited" });
      return json({ error: "edited after it was written" }, 409);
    }
    const door = await appLogin(env, deps);
    if (await markedBy(gh, door, c.id, "rocket")) return json({ sent: 0, already: true });
    const chats = chatsIn(reply.to, s.people).filter((x) => ready(env, x.channel));
    if (!chats.length) {
      log.info("door.out.sent", { task: out.task, sent: 0, why: "no chat in to" });
      return json({ sent: 0, none: true });
    }
    const words = outgoingOf(reply, out.task, withoutLine(c.body), c.html_url);
    const d = await deliver(env, deps, chats, words);
    const unconfirmed = await settle(gh, env, deps, c, out.task, d, s.people, log);
    // The files after the mark, to each chat that has the words.
    const unsent = await sendFiles(
      env,
      deps,
      [...d.sent, ...chats.filter((x) => channelOf(x.channel)?.inPlace)],
      out,
      c.html_url,
      log,
    );
    const said = {
      sent: d.sent.length,
      refused: d.refused.length + d.wrong.length,
      ...(unsent ? { unsent } : {}),
    };
    if (!unconfirmed) return json(said);
    return json({ ...said, error: "a chat didn't confirm it: the watch tells you" }, 502);
  } catch (e) {
    if (e instanceof DoorKeyRefused) {
      log.error("door.out.failed", { why: "door key refused", github: e.status });
      return json({ error: "the door App's key was refused" }, 502);
    }
    log.warn("door.out.failed", { why: String((e as Error)?.message ?? e) });
    return json({ error: passing(e) ? "GitHub didn't answer" : "GitHub refused a call" }, 503);
  }
}

/**
 * After the words: 🚀 once every chat that pushes took them or can't be reached, 😕 when none
 * could take them, and no mark while one didn't confirm them (the watch's notice covers it). A chat
 * that refused what Shipify made is told so at once; one that can't be reached, or can't be told,
 * on the status task. Whether a chat didn't confirm them.
 */
async function settle(
  gh: GitHub,
  env: Env,
  deps: Deps,
  c: RunComment,
  task: number,
  d: Delivery,
  people: Person[],
  log: ReturnType<typeof logOf>,
): Promise<boolean> {
  const notes: Findings["notes"] = [];
  if (d.refused.length) {
    const who = d.refused
      .map((r) => personOf(people, channelOf(r.chat.channel), r.chat.chat)?.name ?? "a chat")
      .join(", ");
    const channel = namesOf(d.refused.map((r) => r.chat));
    const answer = d.refused.at(-1)?.answer ?? "refused";
    notes.push({
      key: `refused:${c.id}`,
      problem: problem("chat-refused", { channel, chat: who, answer }),
    });
    log.warn("door.out.failed", { task, why: "refused for good", refused: d.refused.length });
  }
  for (const w of d.wrong) {
    const ch = channelOf(w.chat.channel);
    const p = problem("chat-rendering", {
      channel: ch?.name ?? w.chat.channel,
      task: String(task),
      answer: w.answer,
    });
    log.error("door.out.failed", { task, why: "refused as made", answer: w.answer });
    const told = await ch?.send(env, deps, w.chat.chat, alertOf(p.what, p.fix, task, c.html_url));
    if (!told?.ok) notes.push({ key: `rendering:${c.id}`, problem: { ...p, where: c.html_url } });
  }
  const unconfirmed = d.unconfirmed.length > 0;
  if (unconfirmed)
    log.warn("door.out.failed", { task, why: "not confirmed", chats: d.unconfirmed.length });
  else {
    const none = !d.sent.length && d.refused.length + d.wrong.length > 0;
    await react(gh, c.id, none ? "confused" : "rocket");
    log.info("door.out.sent", { task, sent: d.sent.length, mark: none ? "confused" : "rocket" });
  }
  await alert(gh, deps, notes);
  return unconfirmed;
}

/**
 * A run's files to each chat that has the reply's words, each once. Any that didn't go are said
 * there in one short message (a chat that reads in place has them on the reply already). How many.
 */
async function sendFiles(
  env: Env,
  deps: Deps,
  chats: Chat[],
  out: Outgoing,
  url: string,
  log: ReturnType<typeof logOf>,
): Promise<number> {
  let all = 0;
  if (!out.files.length) return all;
  for (const x of chats) {
    const ch = channelOf(x.channel);
    if (!ch?.sendFiles) continue;
    const unsent = await ch.sendFiles(env, deps, x.chat, out.task, out.files);
    if (!unsent) continue;
    all += unsent;
    log.warn("door.out.failed", { task: out.task, why: "files unsent", files: unsent });
    if (ch.inPlace) continue;
    const p = problem("files-unsent", {
      files: plural(unsent, "file"),
      they: unsent === 1 ? "It's" : "They're",
    });
    await ch.send(env, deps, x.chat, alertOf(p.what, p.fix, out.task, url));
  }
  return all;
}
