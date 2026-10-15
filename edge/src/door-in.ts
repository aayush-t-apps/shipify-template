// The door's way in (ADR 0031, ADR 0032, ADR 0042): POST /door/<channel>, your messages to
// Shipify from a chat. The channel's adapter (channels/) proves and reads the webhook; everything
// else is here, the same for every channel. Where you type decides the task, with no mode and no
// new state: a fresh message is a new task, a reply carries on the task it replies to, a command
// that starts one (`/ask …`) is always new, and `#12 …` goes to #12.
//  1. It proves the sender: the adapter's proof, then a person in SHIPIFY_PEOPLE on that channel.
//  2. It answers what needs no run, at once, writing nothing: /start, /help, /tasks, /ping (with
//     `/ping pin`, the status pinned where the chat can, and no answer beside it), /apps,
//     /notebook, /recipes, /models, `/use` (the picker), `#12` alone (its head, the reply box on
//     it), a menu command alone, a lone thanks, a wordless photo, a voice note, a pick it can't take.
//  3. It writes everything else as the door App: a comment on #n, or a new task titled from your
//     words (with the pick of the message it replies to, when that asked for one). A retry is
//     written once and an album lands on one task: before writing, it looks for the message in its
//     own recent writes. `close` or `reopen` alone also closes or reopens the task, at once; a `use`
//     alone is a setting for the task's next run.
//  4. It answers "Got it · #12" ("Closed · #12", "From your next message: …").
// A tap on a button is the words it sends, through all of this, then acknowledged (its toast, its
// message drawn again or its spent buttons taken off). A chat sends again anything but a 2xx,
// holding every later message behind it, so every answer is a 200: what broke (GitHub down, the
// door closed, its key refused) is said at once with its fix, to a person, and nothing is written;
// you send it again. It keeps no state: GitHub is its memory.
import {
  acknowledgement,
  agentsSeen,
  appsText,
  errorLine,
  type From,
  fromLine,
  helpText,
  instantOf,
  MOST_LIST,
  modelSearches,
  modelsButtons,
  modelsText,
  notebookText,
  type Picked,
  type Problem,
  pickerAsked,
  pickLabel,
  pickLine,
  pickOf,
  pickWords,
  pingText,
  problem,
  readFrom,
  recipesText,
  reposText,
  STATE_LABELS,
  STAYING_LABEL,
  useCommand,
  withUpcoming,
} from "../../cli/contracts/index.ts";
import { recall, remember, share, shared } from "./cache.ts";
import type { Channel, Message, Shown, Tapped } from "./channels/channel.ts";
import { channelOf } from "./channels/index.ts";
import {
  ALREADY,
  bareCommand,
  GOT_IT,
  goesTo,
  LINK_EXPIRED,
  LINKED,
  linkCode,
  MODEL_UNKEPT,
  MODEL_UNREAD,
  NEEDS_CAPTION,
  NEEDS_WORDS,
  NO_BOX,
  NO_PICK,
  ONLY_ACK,
  PICK_BUTTONS,
  PIN_UNTAKEN,
  REPLY_TO,
  SET_FOR_NEXT,
  startOf,
  TAP_LOST,
  THANKS,
  TURNED,
  TURNED_UNNOTED,
  tapAlone,
  taskOf,
  textOf,
  titleOf,
  told,
  turnOf,
  UNREAD_GITHUB,
  UNREADABLE,
  UNTAKEN,
  unreadable,
  useAlone,
  WELCOME,
  WELCOME_BUTTONS,
  withoutTask,
  YOUR_MODEL,
} from "./chat.ts";
import type { Deps, Env } from "./env.ts";
import { GITHUB_NEEDS, json, logOf, missing, unconfigured } from "./env.ts";
import {
  byDoor,
  DoorKeyRefused,
  type GitHub,
  GitHubError,
  github,
  issueOf,
  passing,
} from "./github.ts";
import {
  openIssues,
  picker,
  pinOf,
  readTask,
  type TaskRead,
  taskHead,
  tasksAnswer,
} from "./guide.ts";
import { keepModel, yourModel } from "./model.ts";
import {
  lastPeople,
  notebookPages,
  personOf,
  runners,
  type Settings,
  settings,
  statusTask,
  toBoxes,
} from "./settings.ts";

/** A message the door reads at most: past it, ignored. */
const MAX_UPDATE_BYTES = 256 * 1024;
/** How far back the door looks for its own writes: well past a chat's retries of one message. */
const RECENT_MS = 15 * 60_000;
/** /apps reads this many apps' health at most. */
const MAX_APPS = 10;

const nothing = () => new Response(null, { status: 200, headers: { "cache-control": "no-store" } });

export async function doorIn(req: Request, env: Env, deps: Deps, ch: Channel): Promise<Response> {
  const log = logOf(deps, "door.in");
  const answer = ch.answer?.bind(ch);
  if (!ch.verify || !ch.parse || !answer) return json({ error: "not_found" }, 404);
  const gone = missing(env, [...ch.needs, ...GITHUB_NEEDS]);
  if (gone.length) return unconfigured(log, gone);
  // The proof first, before the body is read.
  if (!(await ch.verify(req, env))) {
    log.warn("door.in.refused", { why: "unproven", channel: ch.id });
    return json({ error: "unproven" }, 401);
  }
  const ignored = (why: string) => {
    log.info("door.in.refused", { why, channel: ch.id });
    return nothing();
  };
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPDATE_BYTES) return ignored("too big");
  const body = await req.text();
  if (body.length > MAX_UPDATE_BYTES) return ignored("too big");
  const m = ch.parse(body);
  if (!m) return ignored("not a message");
  const say: Say = async (text, what, said = {}) => {
    log.info("door.in.answered", { answer: what, channel: ch.id });
    // A tap is acknowledged whatever it came to; one that says it all needs no new message.
    if (m.tap && ch.tapped && !(await ch.tapped(env, deps, m, said.ack ?? {})))
      log.warn("door.in.answered", { answer: "tap unacknowledged", channel: ch.id });
    if ((m.tap && said.ack?.alone) || said.quiet) return nothing();
    return answer(m, text, said.trouble, said.shown);
  };

  // A link code, from anyone: only a good MAC gets an answer, which tells them their own id.
  const start = startOf(m);
  if (start?.rest && ch.linkSecret) {
    const link = await linkCode(
      start.rest.split(/\s/)[0] ?? "",
      ch.linkSecret(env) ?? "",
      deps.now(),
      ch.id,
    );
    if (!link) return ignored("bad link code");
    return link === "linked"
      ? say(LINKED(ch.name, ch.id, m.user), "linked")
      : say(LINK_EXPIRED(ch.id), "link expired");
  }

  const gh = github(env, deps);
  let s: Settings;
  try {
    s = await settings(gh, deps.now());
  } catch (e) {
    // Who's writing isn't known now: the last good read says, so only a person hears what broke.
    // With none, only words that are harmless to anyone (GitHub down) go out.
    const known = lastPeople(gh);
    if (known && !personOf(known, ch, m.user)) return ignored("not a person");
    return trouble(e, log, say, known !== undefined);
  }
  // Only a person gets in: anyone else gets nothing at all.
  const person = personOf(s.people, ch, m.user);
  if (!person) return ignored("not a person");
  if (s.closed) {
    log.info("door.in.refused", { why: "closed", channel: ch.id });
    const p = problem("door-closed");
    return say(told(p), "closed", { trouble: p });
  }
  // A tap on a message the chat no longer shows whole: no task to put its words on, so none is
  // guessed (never a new task made of "continue").
  if (m.tap && m.repliesTo === undefined && !tapAlone(m.words))
    return say(TAP_LOST, "tap out of reach");
  try {
    const answered = await answerAtOnce(m, ch.id, env, s, gh, deps);
    if (answered) return await say(answered.text, answered.answer, answered);
    return await write(m, ch.id, person.name, env, s, gh, deps, log, say);
  } catch (e) {
    return trouble(e, log, say, true);
  }
}

/** What the door shows with its words, and for a tap, its acknowledgement. */
interface Said {
  trouble?: Problem;
  shown?: Shown;
  /** `alone`: the acknowledgement says it all (the tapped message drawn again): no new message. */
  ack?: Tapped & { alone?: true };
  /** The chat shows it already (a status it pinned): no message beside it. */
  quiet?: true;
}
type Say = (text: string, answer: string, said?: Said) => Promise<Response>;
type Answer = { text: string; answer: string } & Said;

/** A task's link, for the chat to put on its number. */
const linked = (gh: GitHub, task: number): Shown => ({
  task,
  taskUrl: `https://github.com/${gh.repo}/issues/${task}`,
});

/**
 * What broke, said at once with its fix, and nothing written: GitHub down or refusing the write,
 * its key refused (the fix names the door's key), or the door's own bug. Someone the door can't
 * know yet hears only that GitHub can't be reached, whatever broke: the rest is for people.
 */
function trouble(e: unknown, log: ReturnType<typeof logOf>, say: Say, person: boolean) {
  const tell = (p: Problem, what: string) => {
    const q = person ? p : problem("github-down");
    return say(told(q), what, { trouble: q });
  };
  if (e instanceof DoorKeyRefused) {
    log.error("door.in.refused", { why: "door key refused", github: e.status });
    return tell(problem("door-key-refused"), "door key refused");
  }
  if (e instanceof GitHubError && !passing(e)) {
    log.warn("door.in.refused", { why: "github refused", github: e.status });
    return tell(problem("github-refused"), "github refused");
  }
  if (e instanceof GitHubError) {
    log.warn("door.in.refused", { why: "github down", github: e.status });
    return tell(problem("github-down"), "github down");
  }
  log.error("door.in.refused", { why: "unexpected", message: errorLine(e) });
  return tell(problem("door-failed", { first_line: errorLine(e) }), "door failed");
}

/**
 * What's answered here with no run: the commands, going to a task (`#12` alone), the picker, and
 * what would make an empty task.
 */
async function answerAtOnce(
  m: Message,
  channel: string,
  env: Env,
  s: Settings,
  gh: GitHub,
  deps: Deps,
): Promise<Answer | null> {
  const own = m.forwarded ? null : instantOf(m.words);
  if (own?.name === "tasks") {
    const t = await tasksAnswer(gh, deps.now()).catch(() => null);
    if (!t) return { text: UNREAD_GITHUB, answer: "tasks" };
    return {
      text: t.text,
      answer: "tasks",
      shown: { buttons: t.buttons, tasksAt: `https://github.com/${gh.repo}/issues/` },
    };
  }
  // `/ping pin` where the chat can pin: the status, pinned with no sound, and no answer beside it.
  const pin = own?.name === "ping" && /^pin$/i.test(own.rest) ? channelOf(channel)?.pin : undefined;
  if (pin) {
    const [list, open] = await Promise.all([
      runners(gh, deps.now()).catch(() => null),
      openIssues(gh).catch(() => null),
    ]);
    if (!list || !open) return { text: UNREAD_GITHUB, answer: "pin" };
    const p = pinOf(gh, list, open);
    if (await pin(env, deps, m.chat, p.text, p.shown, true))
      return { text: "", answer: "pinned", quiet: true };
    return { text: PIN_UNTAKEN, answer: "pin" };
  }
  if (own?.name === "ping") {
    const [list, status] = await Promise.all([
      runners(gh, deps.now()).catch(() => null),
      statusTask(gh).catch(() => undefined),
    ]);
    if (!list) return { text: UNREAD_GITHUB, answer: "ping" };
    return {
      text: pingText(toBoxes(list), status?.record?.watch.last, deps.now()),
      answer: "ping",
    };
  }
  if (own?.name === "apps") {
    const status = await statusTask(gh).catch(() => null);
    if (status === null) return { text: UNREAD_GITHUB, answer: "apps" };
    const apps = (status?.record?.apps ?? []).slice(0, MAX_APPS);
    const read = await Promise.all(
      apps.map(async (a) => ({ ...a, ...(a.paused ? {} : { health: await health(a.url, deps) }) })),
    );
    return { text: appsText(read), answer: "apps" };
  }
  if (own?.name === "repos") {
    const status = await statusTask(gh).catch(() => null);
    if (status === null) return { text: UNREAD_GITHUB, answer: "repos" };
    const record = status?.record;
    const text = reposText(
      {
        own: (gh.repo.split("/")[0] ?? "").toLowerCase(),
        repos: record?.repos ?? { names: [], projects: [] },
        accounts: s.accounts,
      },
      deps.now(),
    );
    return { text, answer: "repos" };
  }
  if (own?.name === "notebook") {
    const pages = await notebookPages(gh).catch(() => null);
    if (pages === null) return { text: UNREAD_GITHUB, answer: "notebook" };
    return { text: notebookText(pages), answer: "notebook" };
  }
  if (own?.name === "recipes") {
    const status = await statusTask(gh).catch(() => null);
    if (status === null) return { text: UNREAD_GITHUB, answer: "recipes" };
    const rec = status?.record;
    return {
      text: recipesText(withUpcoming(rec?.recipes ?? [], rec?.upcoming ?? []), deps.now()),
      answer: "recipes",
    };
  }
  if (own?.name === "models") {
    const read = await Promise.all(
      modelSearches(own.rest).map(async (g) => [g.gateway, await listOf(g.url, deps)] as const),
    );
    const lists = Object.fromEntries(read);
    // As a reply on a task, its head names the task, so a tap on a find picks for that task.
    const task = taskOf(m);
    const text = modelsText(own.rest, lists);
    return {
      text: task ? `#${task} · ${text}` : text,
      answer: "models",
      shown: { buttons: modelsButtons(own.rest, lists) },
    };
  }
  if (startOf(m)) return { text: WELCOME, answer: "start", shown: { buttons: WELCOME_BUTTONS } };
  if (own) return { text: helpText(), answer: own.name };
  // `/use` alone, or `#12 /use`: the picker, for the task it names or replies to.
  if (!m.forwarded && pickerAsked(withoutTask(m.words, taskOf(m))))
    return pickerFor(m, channel, env, s, gh);
  const to = goesTo(m);
  if (to !== null) {
    const r = await readTask(to, s, gh, true);
    if (r.why) return { text: r.why, answer: "refused" };
    return {
      text: taskHead(to, r),
      answer: "task",
      shown: { ...linked(gh, to), asks: REPLY_TO(to) },
    };
  }
  const bare = bareCommand(m);
  if (bare) return { text: NEEDS_WORDS(bare), answer: "needs words" };
  const file = m.file;
  const words = textOf(m).trim();
  const task = taskOf(m);
  // On a task, a lone thanks may be your answer ("ok"): the door reads the task first (write).
  if (!file && !task && acknowledgement(words) === "thanks")
    return { text: THANKS, answer: "thanks" };
  if (!file && !task && acknowledgement(words) === "yes-no")
    return { text: ONLY_ACK, answer: "acknowledged" };
  if (unreadable(file?.kind) && !words) return { text: UNREADABLE, answer: "unreadable" };
  if (!file && !words) return { text: UNTAKEN, answer: "untaken" };
  // A file with no words and no task to go on (an album's later photos find theirs below).
  if (file && !words && !task && !m.album) return { text: NEEDS_CAPTION, answer: "needs caption" };
  return null;
}

/**
 * `/use` alone: the picker for the task it replies to or names (`#12 /use`; its pick, from its
 * status comment), or your model's, for new tasks.
 */
async function pickerFor(
  m: Message,
  channel: string,
  env: Env,
  s: Settings,
  gh: GitHub,
): Promise<Answer> {
  const task = taskOf(m);
  if (task === null) {
    // Your model: the one your new tasks start with.
    const yours = await yourModel(env, channel, m.chat);
    const p = picker(undefined, "words" in yours && yours.words ? pickOf(yours.words) : undefined);
    const note = "unread" in yours ? `\n(${MODEL_UNREAD}: tapping one sets it again.)` : "";
    return { text: p.text + note, answer: "picker", shown: { buttons: p.buttons } };
  }
  const r = await readTask(task, s, gh, true);
  if (r.why) return { text: r.why, answer: "refused" };
  const p = picker(task, r.use);
  return { text: p.text, answer: "picker", shown: { ...linked(gh, task), buttons: p.buttons } };
}

/** A pick it can't take, told at once with what a `use` takes and the Model button. */
const noPick = (
  say: Say,
  words: string,
  o: { current?: Picked; tapped?: boolean; task?: number },
) =>
  say(NO_PICK(words, { ...o, agent: o.current?.agent }), "refused", {
    shown: { buttons: PICK_BUTTONS },
  });

/**
 * A `use …` alone with no task: your model (model.ts), the one your new tasks start with, kept and
 * said back; from the picker, the picker is drawn again with its ✓ moved. It's read against your
 * model as it is, so `use high` keeps its model at high.
 */
/** The default agent's own Auto: what a task runs with no pick, so no `use` line is needed. */
const isDefaultAuto = (u: Picked) => u.agent === agentsSeen()[0]?.[0] && !u.model && !u.effort;

async function setYours(words: string, m: Message, channel: string, env: Env, say: Say) {
  const yours = await yourModel(env, channel, m.chat);
  const current = "words" in yours && yours.words ? pickOf(yours.words) : undefined;
  const u = pickOf(words, current);
  if (!u) return noPick(say, words, { current, tapped: Boolean(m.tap) });
  if (!(await keepModel(env, channel, m.chat, pickWords(u))))
    return say(MODEL_UNKEPT, "your model unkept");
  return say(YOUR_MODEL(u.label), "your model", {
    ack: { toast: `Your model: ${u.label}`, redraw: picker(undefined, u), alone: true },
  });
}

/** A gateway's public list of models (no key), or null: for /models <word> and the chip's search. */
export async function listOf(url: string, deps: Deps): Promise<string | null> {
  try {
    const res = await deps.fetch(url, { signal: AbortSignal.timeout(5_000) });
    const size = Number(res.headers.get("content-length") ?? 0);
    if (!res.ok || size > MOST_LIST) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** An app's public /health: up with its version, or not. */
async function health(url: string, deps: Deps) {
  try {
    const res = await deps.fetch(`${url.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await res.json().catch(() => null)) as {
      status?: unknown;
      version?: unknown;
    } | null;
    return {
      ok: res.ok && body?.status === "ok",
      ...(typeof body?.version === "string" ? { version: body.version } : {}),
    };
  } catch {
    return { ok: false };
  }
}

/** One write of the door's, as its `from` line tells: which task it's on. */
interface Written {
  task: number;
  from: From;
}

/**
 * The door's own writes of the last 15 minutes: its newest issues and comments (two calls), each
 * with its `from` line, and what this isolate wrote itself (GitHub's listings can lag a moment).
 */
export async function recentWrites(gh: GitHub, now: number): Promise<Written[]> {
  const since = new Date(now - RECENT_MS).toISOString();
  type Item = {
    number?: number;
    issue_url?: string;
    body?: string | null;
    created_at: string;
    performed_via_github_app?: { id?: number } | null;
  };
  const [issues, comments] = await Promise.all([
    gh.json<Item[]>(
      "GET",
      `repos/${gh.repo}/issues?state=all&sort=created&direction=desc&per_page=30`,
    ),
    gh.json<Item[]>(
      "GET",
      `repos/${gh.repo}/issues/comments?sort=created&direction=desc&per_page=50&since=${since}`,
    ),
  ]);
  const read = (i: Item, task: number): Written[] => {
    const from =
      byDoor(gh, i) && Date.parse(i.created_at) >= now - RECENT_MS ? readFrom(i.body) : undefined;
    return from && task > 0 ? [{ task, from }] : [];
  };
  return [
    ...issues.flatMap((i) => read(i, i.number ?? 0)),
    ...comments.flatMap((c) => read(c, issueOf(c.issue_url))),
  ];
}

const memoKey = (repo: string, what: string) => `door:written:${repo}:${what}`;

/** Your words written as the door App, once: on #n, on an album's task, or as a new task. */
async function write(
  m: Message,
  channel: string,
  person: string,
  env: Env,
  s: Settings,
  gh: GitHub,
  deps: Deps,
  log: ReturnType<typeof logOf>,
  say: Say,
): Promise<Response> {
  const id = `${channel}:${m.id}`;
  const album = m.album;
  const now = deps.now();
  // A lone thanks on a task (`ok`, `#12 ok`) is your answer only while it waits on you ("ok" to its
  // question); anywhere else it's a thanks, and nothing is written.
  const asked = taskOf(m);
  let read: TaskRead | undefined;
  if (!m.file && asked !== null && acknowledgement(withoutTask(textOf(m), asked)) === "thanks") {
    read = await readTask(asked, s, gh);
    if (read.why || !read.waiting) return say(THANKS, "thanks");
  }
  // Its own recent writes first: a retry is answered as before, and an album finds its task.
  const memo = (what: string) => recall<number>(memoKey(gh.repo, what), now);
  // This instance's own writes, then the other instances' (Cloudflare's cache), then GitHub's.
  let mine = memo(`id:${id}`) ?? (await shared(memoKey(gh.repo, `id:${id}`)));
  const albumKey = album ? `album:${channel}:${album}` : undefined;
  let albumTask = albumKey
    ? (memo(albumKey) ?? (await shared(memoKey(gh.repo, albumKey))))
    : undefined;
  if (mine === undefined && (!album || albumTask === undefined)) {
    const recent = await recentWrites(gh, now);
    mine = recent.find((w) => w.from.channel === channel && w.from.id === m.id)?.task;
    albumTask ??= album
      ? recent.find((w) => w.from.channel === channel && w.from.album === album)?.task
      : undefined;
  }
  if (mine !== undefined) {
    log.info("door.in.answered", { answer: "written already", channel });
    return album
      ? nothing()
      : say(GOT_IT(mine), "written already", { shown: linked(gh, mine), ack: { spent: true } });
  }
  const file = m.file;
  let text = textOf(m);
  let task = asked ?? albumTask ?? null;
  if (file && !text.trim() && task === null) return say(NEEDS_CAPTION, "needs caption");
  // A `use …` alone is a setting, not words: kept on the task for its next run, starting none.
  // With no task, it's your model, the one your new tasks start with.
  const used = file ? undefined : useAlone(text, task);
  if (used !== undefined && task === null) return setYours(used, m, channel, env, say);
  // A `use` here is judged as the box will judge it, from the task's own pick.
  const picks = used !== undefined || text.split(/\r?\n/).some((l) => useCommand(l) !== undefined);
  let open: boolean | undefined;
  let labels: string[] = [];
  let current: Picked | undefined;
  if (task !== null && task !== albumTask) {
    const r = task === asked && read && !picks ? read : await readTask(task, s, gh, picks);
    if (r.why) {
      log.info("door.in.refused", { why: "task refused", channel });
      return say(r.why, "refused");
    }
    open = r.open;
    labels = r.labels ?? [];
    current = r.use;
  }
  const setting = used === undefined ? undefined : pickOf(used, current);
  if (used !== undefined && !setting)
    return noPick(say, used, { current, tapped: Boolean(m.tap), task: task ?? undefined });
  // A `use` line among your words that can't be taken: told now, and nothing is written (the box
  // would run nothing with it either).
  const line = used === undefined ? pickLine(text, current) : undefined;
  if (line && !line.use) return noPick(say, line.words, { current, task: task ?? undefined });
  // A new task starts with your model (model.ts): a line of its own before your words, as the web
  // chat's chip puts one, unless your words pick it themselves. "Got it" says which.
  const isNew = task === null && albumTask === undefined;
  let model: string | undefined;
  if (isNew && used === undefined) {
    if (line?.use) model = line.use.label;
    else {
      const yours = await yourModel(env, channel, m.chat);
      const u = "words" in yours && yours.words ? pickOf(yours.words) : undefined;
      if (u && "words" in yours && !isDefaultAuto(u)) text = `use ${yours.words}\n${text}`;
      // A store that didn't answer is said; an edge with none (no web chat) is plain Auto.
      model = "unread" in yours ? MODEL_UNREAD : (u?.label ?? pickLabel(undefined, true));
    }
  }
  // `close` or `reopen`: the task changes at once, and the word is written after as a setting (ADR
  // 0040): no run, the chat is told now, and the next run that reads the task notes it. A close
  // takes the state labels off in the same write. Already so, or GitHub failing to change it: said,
  // and nothing is written.
  const turn = task !== null && !file ? turnOf(text, task) : undefined;
  if (task !== null && turn) {
    if (open === (turn === "reopen")) return say(ALREADY(task, Boolean(open)), "already");
    // A run that stays (ADR 0057) leaves on its next read of a closed task: its label goes now.
    const gone = new Set<string>([...STATE_LABELS, STAYING_LABEL]);
    const r = await gh.call("PATCH", `repos/${gh.repo}/issues/${task}`, {
      state: turn === "close" ? "closed" : "open",
      ...(turn === "close"
        ? { state_reason: "completed", labels: labels.filter((l) => !gone.has(l)) }
        : {}),
    });
    if (r.status !== 200) {
      log.warn("door.in.refused", { why: `${turn} failed`, channel, github: r.status });
      const p = problem("turn-failed", { turn, task: String(task) });
      return say(told(p), "turn failed", { trouble: p });
    }
    open = !open;
  }
  const from: From = {
    v: 1,
    person,
    channel,
    chat: m.chat,
    id: m.id,
    ...(album ? { album } : {}),
    ...(setting || turn ? { setting: true as const } : {}),
    ...(file
      ? {
          files: [
            {
              name: file.name,
              ref: `${channel}:${file.ref}`,
              ...(file.type ? { type: file.type } : {}),
              ...(file.size !== undefined ? { size: file.size } : {}),
            },
          ],
        }
      : {}),
  };
  const words = [text.trim(), file ? `📎 ${file.name}` : ""].filter(Boolean).join("\n\n");
  const body = `${fromLine(from)}\n${words}`;
  if (task !== null && turn) {
    // Closed or open already: its note not going is said as what it is, never "nothing saved".
    const noted = await gh.call("POST", `repos/${gh.repo}/issues/${task}/comments`, { body }).then(
      (r) => r.status >= 200 && r.status < 300,
      () => false,
    );
    if (!noted) {
      log.warn("door.in.refused", { why: `${turn} not noted`, channel });
      return say(TURNED_UNNOTED(task, Boolean(open)), "written", {
        shown: linked(gh, task),
        ack: { spent: true },
      });
    }
  } else if (task !== null) {
    await gh.json("POST", `repos/${gh.repo}/issues/${task}/comments`, { body });
  } else {
    const made = await gh.json<{ number: number }>("POST", `repos/${gh.repo}/issues`, {
      title: titleOf(text, file),
      body,
    });
    task = made.number;
  }
  remember(memoKey(gh.repo, `id:${id}`), task, RECENT_MS, now);
  await share(memoKey(gh.repo, `id:${id}`), task, RECENT_MS);
  if (albumKey) {
    remember(memoKey(gh.repo, albumKey), task, RECENT_MS, now);
    await share(memoKey(gh.repo, albumKey), task, RECENT_MS);
  }
  log.info("door.in.written", {
    task,
    channel,
    kind: albumTask === task ? "album" : file ? "file" : "words",
  });
  // An album's later photos land quietly: its first one was answered.
  if (album && albumTask === task) return nothing();
  const shown = linked(gh, task);
  if (turn) return say(TURNED(task, Boolean(open)), "written", { shown, ack: { spent: true } });
  // A pick tapped in the picker: the toast says it, and the picker is drawn again with it.
  if (setting)
    return say(SET_FOR_NEXT(setting.label, task), "setting", {
      shown,
      ack: {
        toast: `#${task}: from your next message, ${setting.label}`,
        redraw: { ...picker(task, setting), ...shown },
        alone: true,
      },
    });
  const online = await runners(gh, now, 30_000)
    .then((list) => toBoxes(list).some((b) => b.online))
    .catch(() => true);
  const got = model ? `${GOT_IT(task)} · ${model}` : GOT_IT(task);
  return say(online ? got : `${got}\n${NO_BOX}`, "written", {
    shown,
    ack: { spent: true },
  });
}
