// `ship selftest chat` (ADR 0031, ADR 0042): every chat channel someone is on, by its own check
// (tools.json: a tool whose way in is a door), then a chat end to end, from your PC. That one posts
// to the edge as Telegram does (with Telegram's secret, from your id), the only channel a PC can
// post as (the web chat's proof is the door App's key, which only the Worker holds), so it needs
// `ship add telegram` done here. It lives with the edge: it names that channel and its route, which
// the core doesn't.
import { credential, loadCredentials } from "../../cli/lib/credentials.ts";
import { run } from "../../cli/lib/exec.ts";
import { ghJson, ghRun, platformRepo } from "../../cli/lib/github.ts";
import type { Check } from "../../cli/lib/output.ts";
import { readPeople } from "../../cli/lib/people.ts";
import { sourceControl } from "../../cli/lib/providers.ts";
import { command, loadTools } from "../../cli/lib/tools.ts";
import { edgeOrigin } from "./worker.ts";

/** How a live check waits for a run: tests hand in their own clock. */
type Wait = { wait?: (ms: number) => Promise<unknown>; maxMs?: number };

/** You, as Telegram posts you to the door (its secret, your id), or why this PC can't. */
function asYou(): You | { skipped: string } {
  const values = loadCredentials().values;
  const [secret, id] = [credential(values, "TELEGRAM_SECRET"), credential(values, "TELEGRAM_ID")];
  const origin = edgeOrigin(sourceControl().repoState(platformRepo()).variables);
  if (!secret || !id || !origin)
    return { skipped: "skipped: Telegram isn't set up on this PC (pnpm ship add telegram --yes)" };
  return {
    async post(text, updateId) {
      const res = await fetch(`${origin}/door/telegram`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": secret,
        },
        body: JSON.stringify({
          update_id: updateId,
          message: {
            message_id: 1,
            date: Math.floor(updateId / 1000),
            chat: { id: Number(id), type: "private" },
            from: { id: Number(id) },
            text,
          },
        }),
        signal: AbortSignal.timeout(20_000),
      }).catch((e: Error) => ({ status: 0, json: async () => ({ text: e.message }) }));
      const said = ((await res.json().catch(() => ({}))) as { text?: string }).text ?? "";
      return { status: res.status, said, task: Number(/Got it · #(\d+)/.exec(said)?.[1] ?? 0) };
    },
  };
}

interface Said {
  status: number;
  said: string;
  task: number;
}

/** A task's run, followed to its end (6 minutes at most), with its log. */
async function finished(task: number, opts: Wait) {
  const repo = platformRepo();
  const wait = opts.wait ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const started = Date.now();
  let run: { id: number; html_url: string; conclusion: string | null } | undefined;
  while (!run && Date.now() - started < (opts.maxMs ?? 6 * 60_000)) {
    await wait(10_000);
    const list = ghJson<{
      workflow_runs: {
        id: number;
        html_url: string;
        status: string;
        conclusion: string | null;
        display_title: string;
      }[];
    }>(["api", `repos/${repo}/actions/workflows/task.yml/runs?per_page=20`]).workflow_runs;
    // The run that ran: one held back behind it in the task's group (your words while it stayed)
    // ends cancelled or skipped, having done nothing (ADR 0057).
    run = list.find(
      (r) =>
        r.display_title === `task #${task}` &&
        r.status === "completed" &&
        r.conclusion !== "cancelled" &&
        r.conclusion !== "skipped",
    );
  }
  return run
    ? { run, log: ghRun(["run", "view", String(run.id), "-R", repo, "--log"]).stdout }
    : undefined;
}

/**
 * Whether a task's run stays after its answer (ADR 0057): its Stay step under way. "done" when the
 * run ended without one, "no run" when none showed in time.
 */
async function staying(task: number, opts: Wait): Promise<"staying" | "done" | "no run"> {
  const repo = platformRepo();
  const wait = opts.wait ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const started = Date.now();
  while (Date.now() - started < (opts.maxMs ?? 6 * 60_000)) {
    await wait(10_000);
    const r = ghJson<{ workflow_runs: { id: number; status: string; display_title: string }[] }>([
      "api",
      `repos/${repo}/actions/workflows/task.yml/runs?per_page=20`,
    ]).workflow_runs.find((x) => x.display_title === `task #${task}`);
    if (!r) continue;
    if (r.status === "completed") return "done";
    const steps = ghJson<{ jobs: { name: string; steps?: { name: string; status: string }[] }[] }>([
      "api",
      `repos/${repo}/actions/runs/${r.id}/jobs`,
    ]).jobs.flatMap((j) => (j.name === "run" ? (j.steps ?? []) : []));
    if (steps.some((st) => st.name.startsWith("Stay (") && st.status === "in_progress"))
      return "staying";
  }
  return "no run";
}

type You = { post: (text: string, updateId: number) => Promise<Said> };

/**
 * A run that stays (ADR 0057), live: once its Stay step is under way, your next words on its task,
 * then, 20 s later, your close, which it reads only after the turn it's on. Whether it stayed.
 */
async function nextWords(
  me: You,
  task: number,
  words: string,
  updateId: number,
  opts: Wait,
): Promise<boolean> {
  if ((await staying(task, opts)) !== "staying") return false;
  await me.post(`#${task} ${words}`, updateId + 1);
  await (opts.wait ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))))(20_000);
  await me.post(`#${task} close`, updateId + 2);
  return true;
}

/** From a finished run's log: its stay answered your next words, and the door sent both replies. */
function stayed(log: string, who: string): Check {
  const line = /run stay: task #\d+: stayed, (\d+) answers?; left: ([^\n[]+)/.exec(log);
  const told = log.split("\n").filter((l) => l.includes('"door.out.sent"')).length;
  const ok = Number(line?.[1] ?? 0) >= 1 && told >= 2;
  return {
    name: `${who} stayed: your next words were answered in the same run`,
    ok,
    detail: line
      ? `${line[1]} answer(s) in the stay; left: ${line[2]?.trim()}; ${told} replies sent`
      : "the run's log has no stay line",
    ...(ok ? {} : { fix: "the run's Stay step says why; SHIPIFY_STAY 0 turns staying off" }),
  };
}

/**
 * Each chat channel someone is on (SHIPIFY_PEOPLE), by its own check from tools.json (the web
 * chat's page and sign-in, Telegram's webhook): its last line says what it found, or what to fix.
 */
function channels(): Check[] {
  const vars = sourceControl().repoState(platformRepo()).variables;
  const { people } = readPeople(vars.SHIPIFY_PEOPLE, vars.SHIPIFY_OWNER);
  return Object.entries(loadTools()).flatMap(([name, t]): Check[] => {
    const door = t.in?.door;
    if (!door || !t.check || !people.some((p) => p.on[door])) return [];
    const { command: cmd, args } = command(t.check);
    const r = run(cmd, args);
    const detail = (r.stdout || r.stderr).trim().split("\n").at(-1) ?? "";
    const fix = /pnpm ship .*$/.exec(detail)?.[0] ?? `pnpm ship add ${name} --yes`;
    return [
      {
        name: `${name}, by its own check`,
        ok: r.code === 0,
        detail,
        ...(r.code === 0 ? {} : { fix }),
      },
    ];
  });
}

export async function chat(opts: Wait = {}) {
  return [...channels(), ...(await endToEnd(opts))];
}

/**
 * A chat, end to end (ADR 0031): a message from you through the door becomes a task, sent again
 * it's written once, a run answers it, and its reply reaches your chat through the door, once. It
 * posts to the edge as Telegram does (with Telegram's secret, from your id), so it needs `ship add
 * telegram` done here; the task it opens is answered, and closes on its own.
 */
async function endToEnd(opts: Wait): Promise<Check[]> {
  const me = asYou();
  if ("skipped" in me)
    return [
      {
        name: "a message through the door, answered once",
        ok: true,
        blocking: false,
        detail: me.skipped,
      },
    ];
  const updateId = Date.now();
  const send = () =>
    me.post("ask: selftest: is the chat working? Answer in one word, ok.", updateId);
  const first = await send();
  const checks: Check[] = [
    {
      name: "a message from you through the door becomes a task",
      ok: first.task > 0,
      detail: first.task ? `#${first.task}` : `the edge answered ${first.status}: ${first.said}`,
    },
  ];
  if (!first.task) return checks;
  const again = await send();
  checks.push({
    name: "sent again, it's written once",
    ok: again.task === first.task,
    detail: again.said,
  });
  // A run that stays after its answer (ADR 0057): your next words, answered by it in seconds, in
  // the same session; then your close ends it. Its log says both.
  const stays = await nextWords(me, first.task, "And now in two words?", updateId, opts);
  // Its run, followed to its end: its log says whether the door took the reply.
  const done = await finished(first.task, opts);
  if (!done) {
    checks.push({
      name: "a run answered it",
      ok: false,
      detail: "no run finished in 6 minutes: is a box online? (pnpm ship box list)",
    });
    return checks;
  }
  const { run, log } = done;
  // An answer: the agent thought and apply wrote an answer, never a failure (a green job can
  // still end in a failed reply).
  const applied = /run apply: task #\d+: \d+ replies \(([^)]*)\)/.exec(log)?.[1] ?? "";
  const answered =
    run.conclusion === "success" && /\banswer\b/.test(applied) && !/failed/.test(applied);
  checks.push({
    name: "a run answered it",
    ok: answered,
    detail: `${run.html_url} (${run.conclusion}; ${applied ? `its reply: ${applied}` : "no reply in its log"})`,
    ...(answered
      ? {}
      : { fix: "its reply on the task says why; a box problem: pnpm ship doctor on the box" }),
  });
  const sent = log.split("\n").find((l) => l.includes('"door.out.sent"'));
  checks.push({
    name: "its reply reached your chat through the door, once",
    ok: Boolean(sent) && !/"sent":0\b/.test(sent ?? ""),
    detail: sent ? "the door sent it (see your phone)" : "the run's log has no door.out.sent line",
  });
  if (stays) checks.push(stayed(log, "it"));
  return checks;
}

/**
 * An agent, live (ADR 0038): a question through the door that names it (`use <agent>`), its run
 * followed to the end: the box installed that agent, it answered, and the reply reached your chat.
 * One model call; only when you name the agent (`ship selftest pi`), never in `all`.
 */
export async function agentLive(agent: string, opts: Wait = {}): Promise<Check[]> {
  const me = asYou();
  if ("skipped" in me)
    return [{ name: `${agent} answers a question`, ok: true, blocking: false, detail: me.skipped }];
  const updateId = Date.now();
  const sent = await me.post(
    `ask: selftest: what is 2 + 2? Answer with the number alone.\nuse ${agent}`,
    updateId,
  );
  const checks: Check[] = [
    {
      name: `a question for ${agent} through the door becomes a task`,
      ok: sent.task > 0,
      detail: sent.task ? `#${sent.task}` : `the edge answered ${sent.status}: ${sent.said}`,
    },
  ];
  if (!sent.task) return checks;
  // Its run stays after the answer (ADR 0057): the next question in the same session, then a close.
  const stays = await nextWords(me, sent.task, "And 3 + 3? The number alone.", updateId, opts);
  const done = await finished(sent.task, opts);
  if (!done)
    return [
      ...checks,
      {
        name: `${agent} answered it`,
        ok: false,
        detail: "no run finished in 6 minutes: is a box online? (pnpm ship box list)",
      },
    ];
  const { run, log } = done;
  const installed = new RegExp(`run agent: task #\\d+: ${agent} at `).test(log);
  checks.push({
    name: `the box has ${agent}, as executors.json pins it`,
    ok: installed,
    detail: installed
      ? "installed (or found) in the box's shared tools"
      : "the run's log has no agent step for it",
    ...(installed
      ? {}
      : { fix: "its run's agent step says why (the task's reply names a broken step)" }),
  });
  const applied = /run apply: task #\d+: \d+ replies \(([^)]*)\)/.exec(log)?.[1] ?? "";
  const answered =
    run.conclusion === "success" && /\banswer\b/.test(applied) && !/failed/.test(applied);
  checks.push({
    name: `${agent} answered it`,
    ok: answered,
    detail: `${run.html_url} (${run.conclusion}; ${applied ? `its reply: ${applied}` : "no reply in its log"})`,
    ...(answered
      ? {}
      : { fix: `its reply on the task says why (a key: pnpm ship add <its gateway> --yes)` }),
  });
  if (stays) checks.push(stayed(log, agent));
  return checks;
}

/**
 * The notebook, live (ADR 0032): `remember Selftest: <stamp>` through the door is written by a run
 * with no agent, `/notebook` through the door shows it, `forget: <stamp>` takes it off again, and the
 * page, empty, is closed. Two short tasks, each closed on its own.
 */
export async function notebookLive(opts: Wait = {}): Promise<Check[]> {
  const me = asYou();
  if ("skipped" in me)
    return [
      {
        name: "a note through the door, kept and forgotten",
        ok: true,
        blocking: false,
        detail: me.skipped,
      },
    ];
  const stamp = `selftest ${Date.now().toString(36)}`;
  const page = async () => (await me.post("/notebook", Date.now())).said;
  const checks: Check[] = [];
  const kept = await me.post(`remember Selftest: ${stamp}`, Date.now());
  const noted = kept.task ? await finished(kept.task, opts) : undefined;
  checks.push({
    name: "remember through the door: a run writes it, with no agent",
    ok: Boolean(noted && noted.run.conclusion === "success" && noted.log.includes('"do":"box"')),
    detail: noted ? noted.run.html_url : kept.task ? "no run finished in 6 minutes" : kept.said,
  });
  const shown = await page();
  checks.push({
    name: "/notebook through the door shows it",
    ok: shown.includes(stamp),
    detail: shown.split("\n\n").find((l) => l.startsWith("Selftest")) ?? shown.slice(0, 200),
  });
  const gone = await me.post(`forget: ${stamp}`, Date.now());
  const forgot = gone.task ? await finished(gone.task, opts) : undefined;
  const after = forgot ? await page() : "";
  checks.push({
    name: "forget through the door takes it off, and the empty page closes",
    ok: Boolean(forgot && forgot.run.conclusion === "success") && !after.includes(stamp),
    detail: forgot ? forgot.run.html_url : gone.task ? "no run finished in 6 minutes" : gone.said,
  });
  return checks;
}
