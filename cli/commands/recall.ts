// `ship recall` (ADR 0078 section 4): your earlier chats, fetched only when a run needs one, never
// put in a prompt by itself. `recall "<words>"` searches your chats and pages as the web chat's Find
// does (edge/src/web/reads.ts `search`): GitHub's issue search by meaning, by words when GitHub
// refuses it, guests' left out (ADR 0071). It shares GitHub's 10 searches by meaning a minute with
// Find, so it asks once, with no second try. `recall <n>` prints one chat, short, as a long
// thread's prompt shows it (kernel/prompt.ts): its Progress first, then each older message as one
// line with its id, which `ship task read <id> --task <n>` prints whole, and its newest 2 whole.
// It runs where `ship notebook read` does: in a run, with the key the run holds.
import { GUEST_LABEL, LIBRARY_LABEL, readFrom, STATUS_LABEL } from "../contracts/index.ts";
import { readRecord, saidOf, type TaskRecord } from "../kernel/snapshot.ts";
import type { RunResult } from "../lib/exec.ts";
import { ghRun, platformRepo } from "../lib/github.ts";
import { NOTEBOOK_LABEL, topicOf } from "../lib/notebook.ts";
import { ok, type Result, ShipError } from "../lib/output.ts";
import { MARK } from "../lib/task.ts";
import { owner } from "./task/context.ts";

const USE =
  'Use: recall "<words>" | recall <n> (an earlier chat: found by its words, or read by its number)';

/** The most hits a search gives (ADR 0078 section 13: about 300 tokens). */
const HITS = 10;
/** What GitHub refuses a search by meaning with: past its 10 a minute, or words it won't take. */
const REFUSED = [403, 422, 429];
/** GitHub takes a query of 256 characters at most: the words are cut to fit with the rest. */
const MOST_WORDS = 200;
/** How long one search may take. */
const SEARCH_MS = 30_000;
/** The newest messages a chat keeps whole. */
const KEPT_WHOLE = 2;
/** The most of an older message's first line kept, as the prompt keeps it. */
const FIRST_LINE = 100;

/** `ship recall "<words>"` or `ship recall <n>`: the words may come unquoted, as several. */
export function recall(args: string[]): Result {
  const said = args.join(" ").trim();
  if (!said) throw new ShipError(USE, "blocked");
  const n = /^#?(\d+)$/.exec(said)?.[1];
  return n ? recallChat(Number(n)) : recallFind(said);
}

/** A guest's, by its labels (ADR 0071): `guest`, or one guest's `guest:<id>`. */
const guests = (labels: string[]) =>
  labels.some((l) => l === GUEST_LABEL || l.startsWith(`${GUEST_LABEL}:`));

/** The HTTP status a failed gh call names ("HTTP 429"), or 0. */
const statusOf = (r: RunResult) =>
  Number(/HTTP (\d{3})/.exec(`${r.stderr}\n${r.stdout}`)?.[1] ?? 0);

/** An issue as GitHub's search lists it. */
interface Hit {
  number: number;
  title: string;
  state: string;
  updated_at?: string;
  labels?: { name?: string }[];
  pull_request?: unknown;
}

/**
 * Up to 10 of your chats and pages for some words, one line each: number, title, state and the day
 * of its last change. Left out: guests', the status task, PRs, and the task this run is on.
 */
function recallFind(words: string): Result {
  const q = encodeURIComponent(
    `repo:${platformRepo()} is:issue -label:${GUEST_LABEL} ${words.slice(0, MOST_WORDS)}`,
  );
  const search = (by: string) =>
    ghRun(["api", `search/issues?q=${q}${by}&per_page=${HITS}`], { timeoutMs: SEARCH_MS });
  let r = search("&search_type=hybrid");
  // Refused: once by words, as Find does. A search by words has a limit of its own.
  const refused = r.code !== 0 && REFUSED.includes(statusOf(r)) ? statusOf(r) : undefined;
  if (refused) r = search("");
  if (r.code !== 0)
    throw new ShipError(
      `The search couldn't run: ${(r.stderr.trim() || r.stdout.trim()).split("\n")[0]}`,
      "failed",
    );
  const found = JSON.parse(r.stdout) as { items?: Hit[]; search_type?: string };
  const own = Number(process.env.SHIPIFY_TASK);
  const hits = (found.items ?? [])
    .filter((i) => {
      const labels = (i.labels ?? []).map((l) => l.name ?? "");
      return (
        !i.pull_request && !guests(labels) && !labels.includes(STATUS_LABEL) && i.number !== own
      );
    })
    .slice(0, HITS)
    .map(
      (i) =>
        `#${i.number} ${i.title.trim()} · ${i.state === "closed" ? "closed" : "open"} · ${(i.updated_at ?? "").slice(0, 10)}`,
    );
  const how = refused
    ? `GitHub refused the search by meaning just now (HTTP ${refused}), so this searched by words: other words may find more.`
    : found.search_type !== "hybrid"
      ? "GitHub searched by words, not by meaning, just now: other words may find more."
      : undefined;
  if (!hits.length) return ok("recall", `No earlier chat found for “${words}”.`, { data: how });
  return ok("recall", `${hits.length} found for “${words}”: \`<ship> recall <n>\` prints one`, {
    data: [...(how ? [how] : []), ...hits].join("\n"),
  });
}

/** A message as a long thread's prompt shows it (kernel/prompt.ts), by the id `task read` takes. */
interface Message {
  id: number;
  who: string;
  at: string;
  text: string;
}
const whole = (m: Message) => `- ${m.who}, ${m.at}:\n${m.text.replace(/^/gm, "  ")}`;
/** An older message as one line: its date, who wrote it, its first line (cut short), its id. */
const oneLine = (m: Message) => {
  const first = m.text.trim().split("\n")[0]?.trim() ?? "";
  const cut = first.length > FIRST_LINE ? `${first.slice(0, FIRST_LINE - 1).trimEnd()}…` : first;
  return `- ${m.at.slice(0, 16).replace("T", " ")}, ${m.who} (id ${m.id}): ${cut}`;
};

/**
 * One chat, short: its title and state, its Progress (the last run's handoff, on its status), then
 * its messages, the newest 2 whole. A guest's is refused (ADR 0071); a page is read as a page.
 */
function recallChat(n: number): Result {
  // Whose words are whose comes from your login (kernel/snapshot.ts): with none, all are others'.
  if (!owner())
    throw new ShipError(
      `#${n} can't be read here: whose words are whose isn't known (SHIPIFY_OWNER). Recall a chat in a run of yours.`,
      "blocked",
    );
  let r: TaskRecord;
  try {
    r = readRecord(n);
  } catch (e) {
    throw new ShipError(`#${n} couldn't be read: ${(e as Error).message}`, "failed");
  }
  const { issue } = r;
  const labels = issue.labels.map((l) => l.name);
  if (guests(labels) || readFrom(issue.body)?.guest)
    throw new ShipError(`#${n} is a guest's: it's theirs alone.`, "blocked");
  if (labels.includes(NOTEBOOK_LABEL.name) || labels.includes(LIBRARY_LABEL))
    throw new ShipError(
      `#${n} is a page: read it with \`<ship> notebook read "${topicOf(issue.title) ?? issue.title}"\`.`,
      "blocked",
    );
  if (issue.pull_request || labels.includes(STATUS_LABEL))
    throw new ShipError(
      `#${n} isn't a chat: it's ${issue.pull_request ? "a pull request" : "Shipify's status task"}.`,
      "blocked",
    );
  // Its opening words as message 0 (`task read 0`), then what was said on it, as the prompt's
  // conversation has them (kernel/think.ts): the status comment and others' words left out.
  const opening = {
    id: 0,
    body: issue.body ?? "",
    user: issue.user,
    created_at: issue.created_at ?? "",
  };
  const messages: Message[] = saidOf(
    n,
    [opening, ...r.comments.filter((c) => !c.body.startsWith(MARK))],
    r.statusId,
  )
    .filter((c) => c.author !== "other" && c.text.trim())
    .map((c) => ({
      id: c.id,
      who: c.author === "run" ? "Shipify" : c.author === "guest" ? "the guest" : "the owner",
      at: c.at,
      text: c.text,
    }));
  const from = messages.length - KEPT_WHOLE;
  const progress = r.state.notes?.trim();
  return ok(
    "recall",
    `#${n} ${issue.title.trim()} · ${issue.state} · ${messages.length} message${messages.length === 1 ? "" : "s"}`,
    {
      data: [
        ...(progress
          ? ["## Progress: the last run's handoff", "", progress, "", "## Messages", ""]
          : []),
        ...(from > 0
          ? [
              `Each before the newest ${KEPT_WHOLE} is one line: when, who, its first line and its id.`,
            ]
          : []),
        ...(messages.length
          ? messages.map((m, i) => (i < from ? oneLine(m) : whole(m)))
          : ["- (no messages yet)"]),
        ...(from > 0
          ? [
              "",
              `\`<ship> task read <id> --task ${n}\` prints one whole (0: the chat's opening words).`,
            ]
          : []),
      ].join("\n"),
    },
  );
}
