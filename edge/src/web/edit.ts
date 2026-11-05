// A doc's Edit in the window (ADR 0071): your words written as its issue's body, as the door App
// (as a Journal line is, capture.ts), under a `from` line that names you, so the notebook counts
// the page as yours (cli/commands/task/notebook.ts, `trusted`). Only a notebook or Library page:
// task.yml starts no run for those, so an edit starts none. Refused when the doc changed after you
// opened it (its `updated_at`, as you read it), and past 60,000 characters, as a run's write is.
import { fromLine, GUEST_LABEL, LIBRARY_LABEL, readFrom } from "../../../cli/contracts/index.ts";
import { type GitHub, GitHubError, guestsOwn } from "../github.ts";
import { NOTEBOOK_LABEL } from "../settings.ts";

/** The most characters a doc's words may have: as a run's write (cli/lib/notebook.ts MAX_PAGE). */
export const MOST_DOC = 60_000;

interface Doc {
  body?: string | null;
  updated_at?: string;
  locked?: boolean;
  pull_request?: unknown;
  labels?: { name: string }[];
  user?: { login?: string; type?: string; id?: number } | null;
  performed_via_github_app?: { id?: number } | null;
}

/** What a save says: the doc's new time, or why it was refused (`status`, and what to do). */
export type Saved = { updated: string } | { status: number; error: string; fix: string };

/** Saves your words on doc `n`, when it is as you read it (`updated`). `id`: this edit's own. */
export async function saveDoc(
  gh: GitHub,
  me: { name: string; chat: string; guest?: string },
  b: { n: number; words: string; updated: string },
  id: string,
): Promise<Saved> {
  const words = b.words.replace(/\r\n?/g, "\n").trimEnd();
  if (words.length > MOST_DOC)
    return {
      status: 413,
      error: `That doc is over ${MOST_DOC.toLocaleString("en")} characters.`,
      fix: "Make it shorter, or ask a run to split it in two.",
    };
  const r = await gh.call("GET", `repos/${gh.repo}/issues/${b.n}`);
  if (r.status !== 200 && r.status !== 404) throw new GitHubError(r.status, "GET doc");
  const i = r.data as Doc | null;
  const labels = (i?.labels ?? []).map((l) => l.name);
  // Whose it is (ADR 0071): a guest edits only their own docs, and you none of a guest's, so a
  // save never moves a doc across the wall. A guest hears the same for none as for another's.
  const theirs = Boolean(i) && labels.includes(GUEST_LABEL);
  const mine = i && (me.guest ? guestsOwn(gh, i, me.guest) : !theirs);
  if (r.status !== 200 || !i || i.pull_request || i.locked || !mine)
    return me.guest || !theirs || !i
      ? { status: 404, error: `There's no doc #${b.n}.`, fix: "Reload the page." }
      : { status: 409, error: `#${b.n} is a guest's doc.`, fix: "Read it; only they edit it." };
  if (!labels.some((l) => (!me.guest && l === NOTEBOOK_LABEL) || l === LIBRARY_LABEL))
    return { status: 409, error: `#${b.n} isn't a doc.`, fix: "Write in it as a chat." };
  if (i.updated_at !== b.updated)
    return { status: 409, error: "It changed.", fix: "Copy your words, then reload." };
  // Its hidden line kept when it names you already; else one that does (a guest's names them).
  const body = i.body ?? "";
  const had = readFrom(body);
  const head =
    had?.person === me.name && had.guest === me.guest
      ? body.split("\n", 1)[0]
      : fromLine({
          v: 1,
          person: me.name,
          channel: "web",
          chat: me.chat,
          id,
          ...(me.guest ? { guest: me.guest } : {}),
        });
  const done = await gh.json<{ updated_at?: string }>("PATCH", `repos/${gh.repo}/issues/${b.n}`, {
    body: `${head}\n${words}\n`,
  });
  return { updated: done.updated_at ?? "" };
}
