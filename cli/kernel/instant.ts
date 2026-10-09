// The chat commands, answered on GitHub (ADR 0032, "Every channel can do the same things"): `/help`,
// `/tasks`, `/ping`, `/apps`, `/repos`, `/notebook`, `/recipes` and `/models` as a comment or a new task's
// title get the same words a chat gets (contracts/answers.ts), read from the open tasks, the status
// task, the notebook and a gateway's public list. A box can't list runners, so `/ping` and `/apps`
// say what the watch last saw.
import { spawnSync } from "node:child_process";
import { readNotebook } from "../commands/task/notebook.ts";
import {
  appsText,
  helpText,
  type Instant,
  MOST_LIST,
  modelSearches,
  modelsText,
  notebookText,
  pingText,
  problem,
  recipesText,
  reposText,
  taskRows,
  tasksText,
  withUpcoming,
} from "../contracts/index.ts";
import { platformAccount, yourAccounts } from "../lib/accounts.ts";
import { githubRecord } from "../lib/github.ts";
import { firstLine, NOTEBOOK_LABEL } from "../lib/notebook.ts";
import { readStatusIssue, STATUS_LABEL } from "../lib/status-issue.ts";

const unread = problem("github-unread");
const UNREAD = `${unread.what} ${unread.fix}`;

export function instantAnswer(name: Instant, now: number, rest = ""): string {
  if (name === "help") return helpText();
  if (name === "models")
    return modelsText(
      rest,
      Object.fromEntries(modelSearches(rest).map((g) => [g.gateway, listOf(g.url)])),
    );
  try {
    if (name === "notebook")
      return notebookText(
        readNotebook().pages.map((p) => ({
          topic: p.topic,
          first: firstLine(p.body),
          lines: p.body.split("\n").filter((l) => l.trim()).length,
          url: p.url ?? "",
        })),
      );
    const st = readStatusIssue({ timeoutMs: 10_000 });
    if (name === "tasks") return tasksText(openTasks(st.upcoming), now);
    if (name === "ping")
      return pingText(
        Object.entries(st.boxes).map(([box, b]) => ({ name: box, online: !b.offline })),
        st.watch.last,
        now,
      );
    if (name === "apps")
      return appsText(
        st.apps.map((a) => ({
          id: a.id,
          url: a.url ?? "",
          paused: Boolean(a.paused),
          health: { ok: !a.failing },
        })),
      );
    if (name === "repos")
      return reposText(
        {
          own: platformAccount(),
          repos: st.repos,
          accounts: yourAccounts(),
        },
        now,
      );
    return recipesText(withUpcoming(st.recipes, st.upcoming), now);
  } catch {
    return UNREAD;
  }
}

/** The open tasks, as /tasks lists them: not a PR, the status task or a notebook page. */
const openTasks = (upcoming: { n: number; next: string }[]) =>
  taskRows(
    githubRecord({ timeoutMs: 10_000 }).issues({ state: "open" }),
    [STATUS_LABEL.name, NOTEBOOK_LABEL.name],
    upcoming,
  );

// Node's own fetch, in a child: decide is synchronous, like the gh calls above. No key is sent.
const READ =
  "fetch(process.argv[1],{signal:AbortSignal.timeout(8000)}).then(r=>r.ok?r.text():Promise.reject()).then(t=>process.stdout.write(t),()=>process.exit(1))";

/** A gateway's public list of models, or null: for /models <word>. */
export function listOf(url: string): string | null {
  const r = spawnSync(process.execPath, ["-e", READ, url], {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: MOST_LIST,
  });
  return r.status === 0 ? r.stdout : null;
}
