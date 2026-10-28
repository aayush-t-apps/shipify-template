#!/usr/bin/env node
import { createHash } from "node:crypto";
// A stand-in for the gh CLI in task tests: one issue in one repo, kept in FAKE_GH_STATE (JSON).
// It answers only the calls `ship task` makes for a task without a project, and fails the rest.
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";

const file = process.env.FAKE_GH_STATE;
// One gh at a time (ADR 0051 B3 starts them together): the state file is read, changed and written
// back whole, so calls made together would lose each other's writes. A lock older than a minute
// is stolen: a gh that died between its read and its write never blocks the rest.
const lock = `${file}.lock`;
for (;;) {
  try {
    mkdirSync(lock);
    break;
  } catch {
    try {
      if (Date.now() - statSync(lock).mtimeMs > 60_000)
        rmSync(lock, { recursive: true, force: true });
    } catch {}
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
  }
}
process.on("exit", () => {
  try {
    rmSync(lock, { recursive: true, force: true });
  } catch {}
});
const state = JSON.parse(readFileSync(file, "utf8"));
const save = () => writeFileSync(file, JSON.stringify(state, null, 2));
const args = process.argv.slice(2);
const stdin = () => {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
};
/**
 * An answer on stdout, written whole before anything exits: a pipe takes a long answer (a log's
 * comments) in parts, and process.exit would cut it short.
 */
const out = (v) => {
  let text = typeof v === "string" ? v : JSON.stringify(v);
  // `gh api -i` (ADR 0057's reads that cost nothing when nothing changed): the status and an ETag,
  // the answer's hash; a 304 with no answer when it matches the If-None-Match sent.
  if (process.argv.includes("-i")) {
    const etag = `"${createHash("sha1").update(text).digest("hex")}"`;
    const asked = process.argv
      .map((a, i, all) => (all[i - 1] === "-H" && /^If-None-Match:/i.test(a) ? a : ""))
      .find(Boolean);
    if (asked && asked.replace(/^If-None-Match:\s*/i, "") === etag) {
      writeSync(1, "HTTP/2.0 304 Not Modified\r\n\r\n");
      save();
      process.exit(1);
    }
    text = `HTTP/2.0 200 OK\r\netag: ${etag}\r\n\r\n${text}`;
  }
  const buf = Buffer.from(`${text}\n`);
  for (let at = 0; at < buf.length; ) {
    try {
      at += writeSync(1, buf, at);
    } catch (e) {
      if (e.code !== "EAGAIN") throw e;
    }
  }
};
const fail = (msg) => {
  process.stderr.write(`fake gh: ${msg}\n`);
  process.exit(1);
};
state.calls.push(args.join(" "));
/** Comments as GitHub lists them: each with its node id, and with `since`, only newer ones. */
const listComments = (list, path) => {
  const since = /[?&]since=([^&]+)/.exec(path ?? "")?.[1];
  const from = since ? Date.parse(decodeURIComponent(since)) : Number.NaN;
  return list
    .filter((c) => {
      const t = Date.parse(c.updated_at ?? c.created_at ?? "");
      return Number.isNaN(from) || Number.isNaN(t) || t >= from;
    })
    .map((c) => ({ node_id: `IC_${c.id}`, ...c }));
};
/**
 * An edit, as GitHub records one: its updated_at moves past when it was written, and an issue whose
 * text changed names who changed it (GraphQL's `editor`), an issue or a comment. The fake makes every
 * write as `bot`.
 */
const edit = (thing, patch) => {
  const text = patch.body !== undefined && patch.body !== thing.body;
  Object.assign(thing, patch);
  const last = Date.parse(thing.updated_at ?? thing.created_at ?? "") || 0;
  thing.updated_at = new Date(Math.max(Date.now(), last + 1000)).toISOString();
  if (text) thing.editor = state.bot;
  return thing;
};

if (args[0] === "label" && args[1] === "create") {
  // Made, by name (a split's label, ADR 0066, is read by GraphQL after it).
  state.labelsMade = [...new Set([...(state.labelsMade ?? []), args[2]])];
  save();
  process.exit(0);
}
// A due run starting a repeating task's run, or a box's clean-up: recorded in calls.
if (args[0] === "workflow" && args[1] === "run") {
  save();
  if (state.noDispatch && args[2] === "task.yml") fail("HTTP 500: Server Error");
  process.exit(0);
}
// A run's log, as `ship door check` and `hook fire` read what a run did: state.logs, by run id.
if (args[0] === "run" && args[1] === "view" && args.includes("--log")) {
  save();
  const log = state.logs?.[args[2]];
  if (log === undefined) fail(`no run ${args[2]}`);
  out(log);
  process.exit(0);
}
// A project's copy for a think (ADR 0029 §4): a few files, with an agent's own settings and git's
// history in it, which the box removes.
if (args[0] === "repo" && args[1] === "clone") {
  const dir = args[3];
  if (state.noClone) fail("HTTP 404: Not Found");
  mkdirSync(join(dir, ".claude"), { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  writeFileSync(join(dir, "README.md"), "# spotter\n");
  writeFileSync(join(dir, ".mcp.json"), "{}");
  writeFileSync(join(dir, ".claude", "settings.json"), "{}");
  save();
  process.exit(0);
}
// A pull request's state (state.prs, by its URL: OPEN, MERGED or CLOSED), and closing one.
if (args[0] === "pr" && args[1] === "view") {
  // A PR is its state ("MERGED"), or its fields: { state, baseRefName, mergeCommit: { oid } }.
  const pr = state.prs?.[args[2]];
  if (!pr) fail("no pull requests found");
  const fields = typeof pr === "object" ? pr : { state: pr };
  out(args.includes("--jq") ? fields.state : fields);
  save();
  process.exit(0);
}
// A branch's pull requests on a repo, newest first: those in state.prs on that repo whose head
// (state.heads, by URL) is the branch; state.forks lists the ones opened from a fork, and
// state.updated when each last changed. state.noPrList: the repo can't be read.
if (args[0] === "pr" && args[1] === "list") {
  const repo = args[args.indexOf("-R") + 1];
  if (state.noPrList) fail(`GraphQL: Could not resolve to a Repository with the name ${repo}.`);
  const head = args[args.indexOf("--head") + 1];
  const list = Object.entries(state.prs ?? {})
    .filter(([url]) => url.startsWith(`https://github.com/${repo}/pull/`))
    .filter(([url]) => state.heads?.[url] === head)
    .map(([url, st]) => ({
      url,
      number: Number(url.split("/").pop()),
      state: st,
      headRefOid: "s1",
      headRefName: head,
      isCrossRepository: Boolean(state.forks?.includes(url)),
      updatedAt: state.updated?.[url] ?? "2026-01-01T00:00:00Z",
    }))
    .filter(
      (p) =>
        !args.includes("--state") ||
        args[args.indexOf("--state") + 1] !== "open" ||
        p.state === "OPEN",
    )
    .sort((a, b) => b.number - a.number);
  // As gh does with `--jq '.[0].url'`: the first one's URL, or nothing.
  out(args.includes("--jq") ? (list[0]?.url ?? "") : list);
  save();
  process.exit(0);
}
// A new PR on a repo, from a branch: kept in state.prs (OPEN) and state.heads; its URL on stdout.
if (args[0] === "pr" && args[1] === "create") {
  const repo = args[args.indexOf("-R") + 1];
  state.prs ??= {};
  state.heads ??= {};
  const n = Object.keys(state.prs).filter((u) => u.includes(`/${repo}/pull/`)).length + 1;
  const url = `https://github.com/${repo}/pull/${n}`;
  state.prs[url] = "OPEN";
  state.heads[url] = args[args.indexOf("--head") + 1];
  save();
  out(url);
  process.exit(0);
}
if (args[0] === "pr" && args[1] === "close") {
  state.prs ??= {};
  if (state.prs[args[2]]) state.prs[args[2]] = "CLOSED";
  // Which token closed it (a test's fake): an App's own, on its own account (ADR 0045).
  state.closedBy ??= {};
  state.closedBy[args[2]] = process.env.GH_TOKEN ?? null;
  save();
  process.exit(0);
}
if (args[0] !== "api") fail(`unsupported: ${args.join(" ")}`);
// The repos an App's token reaches (ADR 0045): state.installs, by the token gh is given, as each
// App's installation lists its own. A token no installation knows is refused.
if (args[1]?.startsWith("installation/repositories")) {
  const list = state.installs?.[process.env.GH_TOKEN ?? ""];
  if (!list) fail("HTTP 403: Resource not accessible by integration");
  // One page, as --paginate --slurp gives it.
  out(args.includes("--slurp") ? [{ repositories: list }] : { repositories: list });
  save();
  process.exit(0);
}
// A branch's rules (state.rules, by "owner/name@branch"): its rulesets' rules, as GitHub lists them.
{
  const r = /^repos\/([^/]+\/[^/]+)\/rules\/branches\/(.+)$/.exec(args[1] ?? "");
  if (r) {
    out(
      (state.rules?.[`${r[1]}@${decodeURIComponent(r[2] ?? "")}`] ?? []).map((type) => ({ type })),
    );
    save();
    process.exit(0);
  }
}
// An account or an App's bot as GitHub knows it (state.users, by login): its id, with --jq .id.
{
  const u = /^users\/(.+)$/.exec(args[1] ?? "");
  if (u) {
    const login = decodeURIComponent(u[1] ?? "");
    const user = state.users?.[login];
    if (!user) fail("HTTP 404: Not Found");
    out(args.includes("--jq") ? String(user.id) : user);
    save();
    process.exit(0);
  }
}
// A branch's newest commit on a repo: state.commits, by "owner/name@branch", its committer's date.
{
  const m = /^repos\/([^/]+\/[^/]+)\/commits\?sha=([^&]+)/.exec(args[1] ?? "");
  if (m) {
    const date = state.commits?.[`${m[1]}@${decodeURIComponent(m[2])}`];
    if (!date) fail("HTTP 404: Not Found");
    out([{ sha: "c1", commit: { committer: { date } } }]);
    save();
    process.exit(0);
  }
}
// Another repo's issue (a case's reply goes on the event's own thread): state.threads, by
// "owner/name#n", each with its comments, its state, and whether it's locked.
{
  const p = args
    .slice(1)
    .find(
      (a, i, all) => !a.startsWith("-") && !["-X", "-H", "--jq", "--input"].includes(all[i - 1]),
    );
  const t = /^repos\/([^/]+\/[^/]+)\/issues\/(\d+)(\/comments)?(?:\?.*)?$/.exec(p ?? "");
  if (t && t[1] !== state.repo) {
    const key = `${t[1]}#${t[2]}`;
    state.threads ??= {};
    state.threads[key] ??= { comments: [], state: "open" };
    const thread = state.threads[key];
    const mi2 = args.indexOf("-X");
    const m2 = mi2 >= 0 ? args[mi2 + 1] : "GET";
    if (thread.gone) fail("HTTP 404: Not Found");
    if (t[3] && m2 === "GET") out(args.includes("--slurp") ? [thread.comments] : thread.comments);
    else if (t[3] && m2 === "POST") {
      if (thread.locked) fail("HTTP 403: Unable to create comment because issue is locked.");
      const id = state.nextId++;
      const c = {
        id,
        body: stdin().body,
        html_url: `https://github.com/${t[1]}/issues/${t[2]}#issuecomment-${id}`,
        // Posted with the bot's token, as a task job's gh is.
        user: { login: "shipify-bot[bot]", type: "Bot" },
      };
      thread.comments.push(c);
      out(c);
    } else if (!t[3] && m2 === "PATCH") {
      const f = Object.fromEntries(
        args.flatMap((a, i) => (args[i - 1] === "-f" ? [a.split(/=(.*)/s).slice(0, 2)] : [])),
      );
      Object.assign(thread, f);
      out({ state: thread.state });
    } else fail(`unsupported: ${args.join(" ")}`);
    save();
    process.exit(0);
  }
}
// GraphQL: pinning the status issue (ADR 0017), and who wrote an issue: one (writers) or every
// one with a label (pages), as GraphQL names them ("github-actions", a Bot).
if (args[1] === "graphql") {
  const query = args.find((a) => a.startsWith("query=")) ?? "";
  const vars = Object.fromEntries(
    args.flatMap((a, i) =>
      (args[i - 1] === "-f" || args[i - 1] === "-F") && !a.startsWith("query=")
        ? [a.split(/=(.*)/s).slice(0, 2)]
        : [],
    ),
  );
  state.others ??= {};
  const all = [state.issue, ...Object.values(state.others).map((o) => o.issue)];
  const actor = (l) =>
    l
      ? {
          login: l.endsWith("[bot]") ? l.slice(0, -5) : l,
          __typename: l.endsWith("[bot]") ? "Bot" : "User",
        }
      : null;
  const node = (i) => ({
    number: i.number,
    title: i.title,
    body: i.body,
    url: `https://github.com/${state.repo}/issues/${i.number}`,
    state: i.state === "closed" ? "CLOSED" : "OPEN",
    labels: { nodes: i.labels },
    author: actor(i.user.login),
    editor: actor(i.editor),
  });
  if (query.includes("timelineItems")) {
    // What closed the issue (state.closer: a PR's URL), as its last ClosedEvent names it.
    const closer = state.closer ? { url: state.closer } : null;
    const jq = args.includes("--jq");
    out(
      jq
        ? (state.closer ?? "")
        : { data: { repository: { issue: { timelineItems: { nodes: [{ closer }] } } } } },
    );
  } else if (query.includes('object(expression:"HEAD:shipify.json")')) {
    // Each repo's shipify.json (state.files, as the contents API reads it), one alias a repo, and
    // null for one it doesn't know: GitHub answers what it could, and gh exits 1 when any wasn't.
    const data = {};
    let missing = false;
    for (const m of query.matchAll(/(r\d+):repository\(owner:"([^"]+)",name:"([^"]+)"\)/g)) {
      const repo = `${m[2]}/${m[3]}`;
      const known = (state.installs ? Object.values(state.installs).flat() : []).some(
        (r) => r.full_name === repo,
      );
      const text = state.files?.[`${repo}/shipify.json`];
      if (!known) missing = true;
      data[m[1]] = known ? { object: text ? { text } : null } : null;
    }
    out({ data });
    save();
    process.exit(missing ? 1 : 0);
  } else if (query.includes("pullRequest(number:") || query.includes("ref(qualifiedName:")) {
    // An errand's look (ADR 0054): a PR (state.errands["o/r#n"]) or a branch
    // (state.errands["o/r@main"]) as GitHub's GraphQL gives it; none, GitHub's error.
    const key = vars.n
      ? `${vars.o}/${vars.r}#${vars.n}`
      : `${vars.o}/${vars.r}@${vars.b.slice(11)}`;
    const it = state.errands?.[key];
    if (!it) fail(`gh: Could not resolve ${key}`);
    out({
      data: { repository: vars.n ? { pullRequest: it } : { ref: { target: it } } },
    });
  } else if (query.includes("node(id:")) {
    // A comment by its node id (IC_<id>): who wrote it and who last edited it.
    const id = Number(String(vars.id).replace(/^IC_/, ""));
    const c = [state.comments, ...Object.values(state.others).map((o) => o.comments)]
      .flat()
      .find((x) => x.id === id);
    out({
      data: {
        node: c ? { author: actor(c.user.login), editor: actor(c.editor) } : null,
      },
    });
  } else if (query.includes("createIssue(")) {
    // A split's parts opened (ADR 0066): each alias a new issue, a sub-issue of $parent.
    const data = {};
    for (const m of query.matchAll(
      /(p\d+): createIssue\(input: \{[^}]*title: \$(t\d+), body: \$(b\d+)/g,
    )) {
      const number = state.nextIssue ?? 200;
      state.nextIssue = number + 1;
      const parent = all.find((i) => `I_${i.number}` === vars.parent);
      const label = String(vars.label).replace(/^L_/, "");
      const issue = {
        number,
        title: vars[m[2]],
        body: vars[m[3]],
        state: "open",
        labels: [{ name: label }],
        user: { login: state.bot },
        parent: parent?.number,
        blockedBy: [],
      };
      state.others[String(number)] = { issue, comments: [] };
      data[m[1]] = { issue: { id: `I_${number}`, number } };
    }
    out({ data });
  } else if (query.includes("addBlockedBy(")) {
    // Its blocked-by links: each issue keeps the numbers it waits for.
    for (const m of query.matchAll(
      /addBlockedBy\(input: \{issueId: \$(a\d+), blockingIssueId: \$(b\d+)/g,
    )) {
      const a = all.find((i) => `I_${i.number}` === vars[m[1]]);
      const b = all.find((i) => `I_${i.number}` === vars[m[2]]);
      if (a && b) a.blockedBy = [...(a.blockedBy ?? []), b.number];
    }
    out({ data: {} });
  } else if (query.includes("label(name: $label)")) {
    // The ids a split needs: the repo's, the label's (null until it's made) and the parent's.
    const i = all.find((x) => x.number === Number(vars.n));
    const made = (state.labelsMade ?? []).includes(vars.label);
    out({
      data: {
        repository: {
          id: "R_1",
          label: made ? { id: `L_${vars.label}` } : null,
          issue: i
            ? {
                id: `I_${i.number}`,
                subIssues: {
                  nodes: all
                    .filter((k) => k.parent === i.number)
                    .map((k) => ({ id: `I_${k.number}`, number: k.number, title: k.title })),
                },
              }
            : null,
        },
      },
    });
  } else if (query.includes("parent {")) {
    // A task's family (ADR 0066): its parent's when it has one, else its own parts.
    const gstate = (i) => (i.state === "closed" ? "CLOSED" : "OPEN");
    const reason = (i) => (i.state_reason ? String(i.state_reason).toUpperCase() : null);
    const fam = (i) => ({
      number: i.number,
      title: i.title,
      body: i.body,
      state: gstate(i),
      labels: { nodes: i.labels },
      subIssues: {
        nodes: all
          .filter((k) => k.parent === i.number)
          .map((k) => ({
            number: k.number,
            title: k.title,
            state: gstate(k),
            stateReason: reason(k),
            labels: { nodes: k.labels },
            blockedBy: {
              nodes: (k.blockedBy ?? [])
                .map((b) => all.find((x) => x.number === b))
                .filter(Boolean)
                .map((b) => ({ number: b.number, state: gstate(b), stateReason: reason(b) })),
            },
            closedByPullRequestsReferences: { nodes: k.pr ? [{ url: k.pr }] : [] },
          })),
      },
    });
    const i = all.find((x) => x.number === Number(vars.n));
    const parent = i?.parent ? all.find((x) => x.number === i.parent) : undefined;
    out({
      data: {
        repository: { issue: i ? { ...fam(i), parent: parent ? fam(parent) : null } : null },
      },
    });
  } else if (query.includes("issue(number:")) {
    // `unreadable`: an issue GraphQL answers null for (a hiccup, or one it can't see).
    const i = all.find((x) => x.number === Number(vars.n) && !x.unreadable);
    out({ data: { repository: { issue: i ? node(i) : null } } });
  } else if (query.includes("issues(first:")) {
    const both = query.includes("OPEN, CLOSED");
    const nodes = all
      .filter((i) => i.labels.some((l) => l.name === vars.label) && (both || i.state !== "closed"))
      .sort((a, b) => a.number - b.number)
      .map(node);
    out({ data: { repository: { issues: { nodes } } } });
  } else out({ data: {} });
  save();
  process.exit(0);
}
const rest = args.slice(1);
let method = "GET";
const mi = rest.indexOf("-X");
if (mi >= 0) method = rest[mi + 1];
const path = rest.find(
  (a, i) =>
    !a.startsWith("-") &&
    rest[i - 1] !== "-X" &&
    rest[i - 1] !== "-H" &&
    rest[i - 1] !== "--jq" &&
    rest[i - 1] !== "--input",
);
// A commit's marks (ADR 0030 §5: shipify/main after a deploy), by its path, in state.commitStatus;
// and a repo's main commit, in state.mainSha by repo.
if (method === "GET" && /^repos\/[^/]+\/[^/]+\/commits\/[0-9a-f]{7,40}\/status$/.test(path ?? "")) {
  const marks = state.commitStatus?.[path];
  if (!marks) fail("Not Found (HTTP 404)");
  out({ statuses: marks });
  save();
  process.exit(0);
}
// A file on a repo's default branch (state.files, by "<owner/repo>/<path>"), as the contents API
// gives it: base64.
const fileOf = /^repos\/([^/]+\/[^/]+)\/contents\/(.+)$/.exec(path ?? "");
if (method === "GET" && fileOf && state.files) {
  const text = state.files[`${fileOf[1]}/${fileOf[2]}`];
  if (text === undefined) fail("Not Found (HTTP 404)");
  const content = Buffer.from(text).toString("base64");
  out(rest.includes("--jq") ? content : { content, encoding: "base64" });
  save();
  process.exit(0);
}
const mainOf = /^repos\/([^/]+\/[^/]+)\/commits\/main$/.exec(path ?? "");
if (method === "GET" && mainOf) {
  const sha = state.mainSha?.[mainOf[1]];
  if (!sha) fail("Not Found (HTTP 404)");
  out(rest.includes("--jq") ? sha : { sha });
  save();
  process.exit(0);
}
// More issues than the task's (#12): ones the door opens (ADR 0027), in state.others by number.
state.others ??= {};
const other = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)(\/.*)?$/.exec(path ?? "");
const otherN = other && Number(other[1]);
if (otherN && otherN !== state.issue.number && otherN !== (state.status?.number ?? 900)) {
  const o = state.others[otherN];
  if (!o) fail("Not Found (HTTP 404)");
  const sub = other[2] ?? "";
  if (method === "GET" && sub === "") out(o.issue);
  else if (method === "PATCH" && sub === "") out(edit(o.issue, stdin(), true));
  else if (method === "GET" && sub.startsWith("/comments")) {
    const list = listComments(o.comments, path);
    out(rest.includes("--slurp") ? [list] : list);
  } else if (method === "POST" && sub === "/comments") {
    const c = {
      id: state.nextId++,
      body: stdin().body,
      user: { login: state.bot },
      created_at: "now",
    };
    o.comments.push(c);
    out({ id: c.id });
  } else if (method === "POST" && sub === "/labels") {
    for (const l of stdin().labels)
      if (!o.issue.labels.some((x) => x.name === l)) o.issue.labels.push({ name: l });
    out(o.issue.labels);
  } else if (method === "DELETE" && sub.startsWith("/labels/")) {
    const name = decodeURIComponent(sub.split("/").pop());
    o.issue.labels = o.issue.labels.filter((l) => l.name !== name);
    out([]);
  } else if (method === "POST" && sub === "/reactions") out({ content: "eyes" });
  else fail(`unsupported: ${args.join(" ")}`);
  save();
  process.exit(0);
}
const issue = state.issue;
// A side branch's files (screenshots, a task's files): blobs, trees and commits, by made-up shas,
// and what each upload put there, in state.uploads.
const git = /^repos\/([^/]+\/[^/]+)\/git\/(blobs|trees|commits|refs|ref\/heads)(?:\/(.+))?$/.exec(
  path ?? "",
);
if (git) {
  const [, repo, kind, rest] = git;
  state.refs ??= {};
  state.uploads ??= [];
  const sha = () => `s${state.nextId++}`;
  if (method === "POST" && kind === "blobs") out({ sha: sha() });
  else if (method === "POST" && kind === "trees") {
    const b = stdin();
    state.uploads.push({ repo, paths: b.tree.map((x) => x.path) });
    out({ sha: sha() });
  } else if (method === "POST" && kind === "commits") out({ sha: sha() });
  else if (method === "POST" && kind === "refs") {
    state.refs[`${repo}:${stdin().ref}`] = true;
    out({});
  } else if (method === "PATCH" && kind === "refs") out({});
  else if (method === "GET" && kind === "ref/heads") {
    if (!state.refs[`${repo}:refs/heads/${rest}`]) fail("Not Found (HTTP 404)");
    out("s1");
  } else if (method === "GET" && kind === "commits") out("t1");
  else fail(`unsupported: ${args.join(" ")}`);
  save();
  process.exit(0);
}
const base = `repos/${state.repo}/issues/${issue.number}`;
// The watch (ADR 0019): a workflow's recent runs.
const runsPath = /^repos\/[^/]+\/[^/]+\/actions\/workflows\/([^/]+)\/runs/.exec(path ?? "");
// One run, by its id (the door's answer names the run it started).
const runById = /^repos\/[^/]+\/[^/]+\/actions\/runs\/(\d+)$/.exec(path ?? "");

// An issue being opened: its body, read once (stdin can be read only once).
const opening = method === "POST" && path === `repos/${state.repo}/issues` ? stdin() : undefined;
const listed = (labels, st = "open") =>
  [issue, ...Object.values(state.others).map((o) => o.issue)].filter(
    (i) =>
      (st === "all" || i.state === st) &&
      (!labels || labels.split(",").every((l) => i.labels.some((x) => x.name === l))),
  );
// GitHub failing to list the recipes' tasks (a test sets it).
if (state.noRecipeList && method === "GET" && /[?&]labels=recipe(&|$)/.test(path ?? ""))
  fail("HTTP 502: Bad Gateway");
// Shipify's own status issue (ADR 0017), kept apart from the task's issue.
const STATUS = `repos/${state.repo}/issues/${state.status?.number ?? 900}`;
if (method === "GET" && path?.startsWith(`repos/${state.repo}/labels`))
  out(rest.includes("--slurp") ? [state.labels ?? []] : (state.labels ?? []));
else if (method === "GET" && /[?&]labels=shipify-status/.test(path ?? "")) {
  // statusDown: GitHub doesn't answer for the status issue.
  if (state.statusDown) fail("HTTP 502: Bad Gateway");
  out(state.status ? [state.status] : []);
} else if (
  method === "POST" &&
  path === `repos/${state.repo}/issues` &&
  !opening?.labels?.includes("shipify-status")
) {
  // A door-filed task (ADR 0027): numbered after the task's, kept with its comments.
  const b = opening;
  const n = Math.max(state.issue.number, ...Object.keys(state.others).map(Number)) + 1;
  state.others[n] = {
    issue: {
      number: n,
      title: b.title,
      body: b.body,
      state: "open",
      labels: (b.labels ?? []).map((name) => ({ name })),
      user: { login: state.bot },
      created_at: new Date().toISOString(),
      ...(b.assignees ? { assignees: b.assignees.map((login) => ({ login })) } : {}),
    },
    comments: [],
  };
  out(state.others[n].issue);
} else if (method === "POST" && path === `repos/${state.repo}/issues`) {
  const b = opening;
  state.status = {
    number: 900,
    node_id: "I_900",
    title: b.title,
    body: b.body,
    labels: b.labels.map((name) => ({ name })),
    comments: [],
  };
  out(state.status);
} else if (method === "PATCH" && path === STATUS && state.status) {
  out(edit(state.status, stdin(), true));
} else if (method === "POST" && path === `${STATUS}/comments` && state.status) {
  state.status.comments.push(stdin().body);
  out({ id: state.nextId++ });
} else if (method === "GET" && runsPath) out({ workflow_runs: state.runs?.[runsPath[1]] ?? [] });
// A run asked to run again (a project's redeploy): only the call, in calls.
else if (method === "POST" && /^repos\/[^/]+\/[^/]+\/actions\/runs\/\d+\/rerun$/.test(path ?? ""))
  out({});
else if (method === "GET" && runById) {
  const run = Object.values(state.runs ?? {})
    .flat()
    .find((r) => r.id === Number(runById[1]));
  if (!run) fail("Not Found (HTTP 404)");
  out(run);
}
// The run's own jobs and their steps, as `run failed` reads which step broke: state.jobs.
else if (
  method === "GET" &&
  /^repos\/[^/]+\/[^/]+\/actions\/runs\/\d+\/attempts\/\d+\/jobs/.test(path ?? "")
)
  out({ jobs: state.jobs ?? [] });
// Publishing's check (ADR 0026): this token may list the repo's variables, unless a test says not.
else if (method === "GET" && path?.startsWith(`repos/${state.repo}/actions/variables`)) {
  if (state.noVariables) fail("HTTP 403: Resource not accessible by integration");
  out({ total_count: 0, variables: [] });
}
// Runs waiting for a machine, when a test says (`queued`: each run's id and its jobs).
else if (
  method === "GET" &&
  state.queued &&
  path?.startsWith(`repos/${state.repo}/actions/runs?status=queued`)
)
  out({ workflow_runs: state.queued.map((r) => ({ id: r.id })) });
else if (method === "GET" && /\/actions\/runs\/\d+\/jobs/.test(path ?? "")) {
  const id = Number(/\/runs\/(\d+)\/jobs/.exec(path)[1]);
  out({ jobs: (state.queued ?? []).find((r) => r.id === id)?.jobs ?? [] });
}
// What's running, when a test says (`active`: each run's display title, "task #13" say).
else if (method === "GET" && state.active && path?.startsWith(`repos/${state.repo}/actions/runs?`))
  out({ workflow_runs: state.active.map((display_title) => ({ display_title })) });
// The clean-up's look at what's running: nothing, in these tests.
else if (method === "GET" && path?.startsWith(`repos/${state.repo}/actions/runs?`))
  out({ workflow_runs: [] });
// GitHub failing to answer for the task's issue (`issueError`: "HTTP 502: Bad Gateway", say).
else if (method === "GET" && path === base && state.issueError) fail(state.issueError);
else if (method === "GET" && path === base) out(issue);
else if (method === "GET" && path?.startsWith(`repos/${state.repo}/issues?`)) {
  const q = new URLSearchParams(path.split("?")[1]);
  const found = listed(q.get("labels"), q.get("state") ?? "open");
  out(rest.includes("--slurp") ? [found] : found);
} else if (method === "GET" && path?.startsWith(`${base}/comments`)) {
  const list = listComments(state.comments, path);
  out(rest.includes("--slurp") ? [list] : list);
} else if (method === "POST" && path === `${base}/comments`) {
  // GitHub answering 500 to new comments, as on 2026-10-07 (`commentsLeft`: how many it takes first).
  if (state.commentsLeft === 0) fail("HTTP 500: Server Error");
  if (state.commentsLeft) state.commentsLeft--;
  // GitHub refusing the next few comments, then taking them again (`commentsFail`: how many).
  if (state.commentsFail > 0) {
    state.commentsFail--;
    save();
    fail("HTTP 502: Bad Gateway");
  }
  const c = {
    id: state.nextId++,
    body: stdin().body,
    user: { login: state.bot },
    created_at: "now",
  };
  state.comments.push(c);
  out({ id: c.id });
} else if (method === "PATCH" && path?.startsWith(`repos/${state.repo}/issues/comments/`)) {
  // The task's comments, or another issue's (a door task, a recipe's log).
  const id = Number(path.split("/").pop());
  const c = [state.comments, ...Object.values(state.others).map((o) => o.comments)]
    .flat()
    .find((x) => x.id === id);
  if (!c) fail(`no comment ${id}`);
  out(edit(c, { body: stdin().body }));
} else if (method === "DELETE" && path?.startsWith(`repos/${state.repo}/issues/comments/`)) {
  const id = Number(path.split("/").pop());
  state.comments = state.comments.filter((x) => x.id !== id);
  for (const o of Object.values(state.others)) o.comments = o.comments.filter((x) => x.id !== id);
  out({});
} else if (method === "POST" && path?.endsWith("/reactions")) {
  out({ content: "eyes" });
} else if (method === "POST" && path === `${base}/labels`) {
  for (const l of stdin().labels)
    if (!issue.labels.some((x) => x.name === l)) issue.labels.push({ name: l });
  out(issue.labels);
} else if (method === "DELETE" && path?.startsWith(`${base}/labels/`)) {
  const name = decodeURIComponent(path.split("/").pop());
  issue.labels = issue.labels.filter((l) => l.name !== name);
  out([]);
} else if (method === "PATCH" && path === base) {
  out(edit(issue, stdin(), true));
} else fail(`unsupported: ${args.join(" ")}`);
save();
