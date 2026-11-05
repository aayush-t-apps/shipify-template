// The record plug-in's conformance test (ADR 0027, cli/lib/plugins/record.ts): every record and
// queue Shipify can use passes the same suite. GitHub runs here against the fake gh
// (tests/fixtures/fake-gh.mjs). A new record (Forgejo, say) joins RECORDS with its own fake.
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { githubQueue, githubRecord } from "../../cli/lib/github.ts";
import type { Queue, RecordComment, TaskRecord } from "../../cli/lib/plugins/record.ts";
import { ROOT } from "../helpers.ts";

type FakeIssue = {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: { name: string }[];
  user: { login: string };
  /** Who last changed its text, as the fake keeps it ("x[bot]" for an app). */
  editor?: string;
  /** GraphQL answers null for it. */
  unreadable?: boolean;
};
interface Fake {
  issue: FakeIssue;
  others?: Record<string, { issue: FakeIssue; comments: unknown[] }>;
  comments: { id: number; body: string }[];
  calls: string[];
  noDispatch?: boolean;
  runs?: Record<string, unknown[]>;
}

/** GitHub against the fake gh, in this process: PATH and the fake's state, put back after. */
function fakeGithub() {
  const saved = { ...process.env };
  let file = "";
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "record-"));
    symlinkSync(join(ROOT, "tests/fixtures/fake-gh.mjs"), join(dir, "gh"));
    file = join(dir, "gh.json");
    writeFileSync(
      file,
      JSON.stringify({
        repo: "o/shipify",
        bot: "github-actions[bot]",
        nextId: 100,
        issue: {
          number: 12,
          title: "make it faster",
          body: "",
          state: "open",
          labels: [],
          user: { login: "owner" },
        },
        comments: [],
        calls: [],
        runs: {
          "watch.yml": [
            {
              status: "completed",
              conclusion: "success",
              display_title: "due",
              created_at: "2026-10-03T08:00:00Z",
            },
          ],
        },
      }),
    );
    Object.assign(process.env, {
      PATH: `${dir}:${saved.PATH}`,
      FAKE_GH_STATE: file,
      GITHUB_REPOSITORY: "o/shipify",
      SHIPIFY_ISSUES_TOKEN: "issues-token",
    });
  });
  afterEach(() => {
    process.env = { ...saved };
  });
  return {
    read: () => JSON.parse(readFileSync(file, "utf8")) as Fake,
    set: (change: (f: Fake) => void) => {
      const f = JSON.parse(readFileSync(file, "utf8")) as Fake;
      change(f);
      writeFileSync(file, JSON.stringify(f));
    },
  };
}

const RECORDS: { name: string; make: () => { record: TaskRecord; queue: Queue } }[] = [
  { name: "github", make: () => ({ record: githubRecord(), queue: githubQueue() }) },
];

describe.each(RECORDS)("the record plug-in: $name", ({ make }) => {
  const fake = fakeGithub();

  it("reads a task, and lists the open ones by label", () => {
    const { record } = make();
    expect(record.issue(12)).toMatchObject({ number: 12, state: "open", user: { login: "owner" } });
    expect(record.issues().map((i) => i.number)).toEqual([12]);
    expect(record.issues({ labels: ["repeats"] })).toEqual([]);
  });

  it("keeps a conversation: comment, edit, read back, delete", () => {
    const { record } = make();
    const id = record.comment(12, "hello");
    expect(typeof id).toBe("number");
    record.editComment(id, "hello again");
    expect(record.comments(12).map((c) => c.body)).toEqual(["hello again"]);
    expect(record.deleteComment(id)).toBe(true);
    expect(record.comments(12)).toEqual([]);
  });

  it("shows an edit: a comment's updated_at moves on, and a task names who changed its text", () => {
    const { record } = make();
    const id = record.comment(12, "hello");
    const [before] = record.comments(12);
    expect([undefined, before?.created_at]).toContain(before?.updated_at);
    record.editComment(id, "hello again");
    const [after] = record.comments(12);
    expect(after?.updated_at).toEqual(expect.any(String));
    expect(after?.updated_at).not.toBe(after?.created_at);
    record.updateIssue(12, { state: "closed", state_reason: "completed" });
    expect(record.writers(12)).toEqual({ author: "owner" });
    record.updateIssue(12, { body: "faster, please" });
    // The record's calls run as the workflow's token: github-actions[bot].
    expect(record.writers(12)).toEqual({ author: "owner", editor: "github-actions[bot]" });
  });

  it("says who opened a task and who last edited it, an app's name with [bot]", () => {
    const { record } = make();
    fake.set((f) => {
      f.issue.user.login = "github-actions[bot]";
      f.issue.editor = "owner";
    });
    expect(record.writers(12)).toEqual({ author: "github-actions[bot]", editor: "owner" });
    fake.set((f) => {
      f.issue.user.login = "owner";
      f.issue.editor = "shipify-bot[bot]";
    });
    expect(record.writers(12)).toEqual({ author: "owner", editor: "shipify-bot[bot]" });
  });

  it("says who wrote a comment and who last edited it (a recipe's log trusts its status by them)", () => {
    const { record } = make();
    const id = record.comment(12, "the status");
    const [c] = record.comments(12);
    expect(c?.node_id).toEqual(expect.any(String));
    expect(record.commentWriters(c as { id: number; node_id?: string })).toEqual({
      author: "github-actions[bot]",
    });
    record.editComment(id, "the status, again");
    expect(record.commentWriters(c as { id: number; node_id?: string })).toEqual({
      author: "github-actions[bot]",
      editor: "github-actions[bot]",
    });
    fake.set((f) => {
      (f.comments[0] as { editor?: string }).editor = "shipify-bot[bot]";
    });
    expect(record.commentWriters(c as { id: number; node_id?: string }).editor).toBe(
      "shipify-bot[bot]",
    );
  });

  it("reads a task in one call: its issue and comments as issue and comments do, each with its editor (ADR 0069)", () => {
    const { record } = make();
    const first = record.comment(12, "the status");
    record.comment(12, "more words");
    record.editComment(first, "the status, again");
    fake.set((f) => {
      f.issue.labels = [{ name: "working" }];
    });
    const before = fake.read().calls.length;
    const { issue, comments } = record.task(12);
    // One call, where issue, comments and commentWriters took three.
    expect(fake.read().calls.length - before).toBe(1);
    const rest = record.issue(12);
    expect(issue).toMatchObject({
      number: rest.number,
      title: rest.title,
      state: rest.state,
      labels: rest.labels,
      user: rest.user,
    });
    // What a run reads of each, the same either way.
    const seen = (c: RecordComment) => [c.id, c.body, c.user.login, c.created_at, c.updated_at];
    expect(comments.map(seen)).toEqual(record.comments(12).map(seen));
    expect(comments.map((c) => c.editor)).toEqual(["github-actions[bot]", undefined]);
    expect(comments[0]?.user.login).toBe("github-actions[bot]");
  });

  it("reads a long task's comments page by page, all of them", () => {
    const { record } = make();
    fake.set((f) => {
      f.comments = Array.from({ length: 230 }, (_, i) => ({
        id: 1000 + i,
        body: `c${i}`,
        user: { login: "owner" },
        created_at: "2026-11-01T12:00:00Z",
      }));
    });
    const before = fake.read().calls.length;
    const { comments } = record.task(12);
    expect(fake.read().calls.length - before).toBe(3);
    expect(comments.map((c) => c.body)).toEqual(record.comments(12).map((c) => c.body));
    expect(comments).toHaveLength(230);
  });

  it("reads only the comments written or edited since a time, when asked", () => {
    const { record } = make();
    record.comment(12, "old");
    fake.set((f) => {
      Object.assign(f.comments[0] as object, {
        created_at: "2026-10-01T08:00:00Z",
        updated_at: "2026-10-01T08:00:00Z",
      });
    });
    record.comment(12, "new");
    expect(record.comments(12, "2026-10-02T00:00:00Z").map((c) => c.body)).toEqual(["new"]);
    expect(record.comments(12).map((c) => c.body)).toEqual(["old", "new"]);
  });

  it("opens an issue assigned to someone", () => {
    const { record } = make();
    const made = record.createIssue({ title: "Recipe: x", body: "b", assignees: ["owner"] });
    expect(fake.read().others?.[String(made.number)]?.issue).toMatchObject({
      assignees: [{ login: "owner" }],
    });
  });

  it("names no one for a task it can't read: the ghost, and no editor", () => {
    const { record } = make();
    fake.set((f) => {
      f.issue.user.login = "github-actions[bot]";
      f.issue.unreadable = true;
    });
    expect(record.writers(12)).toEqual({ author: "ghost" });
    expect(record.writers(404)).toEqual({ author: "ghost" });
  });

  it("lists the pages with a label, open or all, each with its state, labels and writers", () => {
    const { record } = make();
    const page = (number: number, more: Partial<FakeIssue>): FakeIssue => ({
      number,
      title: `Notebook: page ${number}`,
      body: `- note ${number}`,
      state: "open",
      labels: [{ name: "notebook" }],
      user: { login: "github-actions[bot]" },
      ...more,
    });
    fake.set((f) => {
      f.others = {
        "20": { issue: page(20, { editor: "owner" }), comments: [] },
        "21": {
          issue: page(21, { state: "closed", user: { login: "shipify-bot[bot]" } }),
          comments: [],
        },
        "22": {
          issue: page(22, { labels: [{ name: "recipe" }, { name: "pinned" }] }),
          comments: [],
        },
        "23": {
          issue: page(23, { labels: [{ name: "notebook" }, { name: "pinned" }], body: "" }),
          comments: [],
        },
      };
    });
    expect(record.pages("notebook")).toEqual([
      {
        number: 20,
        title: "Notebook: page 20",
        body: "- note 20",
        state: "open",
        labels: [{ name: "notebook" }],
        url: "https://github.com/o/shipify/issues/20",
        author: "github-actions[bot]",
        editor: "owner",
      },
      {
        number: 23,
        title: "Notebook: page 23",
        body: "",
        state: "open",
        labels: [{ name: "notebook" }, { name: "pinned" }],
        url: "https://github.com/o/shipify/issues/23",
        author: "github-actions[bot]",
      },
    ]);
    expect(record.pages("notebook", "all").map((p) => [p.number, p.state, p.author])).toEqual([
      [20, "open", "github-actions[bot]"],
      [21, "closed", "shipify-bot[bot]"],
      [23, "open", "github-actions[bot]"],
    ]);
    expect(record.pages("recipe").map((p) => p.number)).toEqual([22]);
  });

  it("labels a task, and takes a label off", () => {
    const { record } = make();
    record.makeLabel({
      name: "working",
      color: "2f5bd3",
      description: "A box is running this task",
    });
    record.addLabels(12, ["working"]);
    expect(record.issue(12).labels.map((l) => l.name)).toEqual(["working"]);
    record.removeLabel(12, "working");
    expect(record.issue(12).labels).toEqual([]);
    expect(Array.isArray(record.labels())).toBe(true);
  });

  it("makes independent writes together, and returns the new comments' ids (ADR 0051 B3)", async () => {
    const { record } = make();
    record.makeLabel({
      name: "working",
      color: "2f5bd3",
      description: "A box is running this task",
    });
    record.makeLabel({ name: "answered", color: "1a7f37", description: "Answered" });
    record.addLabels(12, ["working"]);
    const ids = await record.together([
      { w: "react", on: { issue: 12 }, content: "eyes" },
      { w: "unlabel", n: 12, name: "working" },
      { w: "labels", n: 12, names: ["answered"] },
      { w: "comment", n: 12, body: "Working on it." },
    ]);
    expect(ids).toHaveLength(1);
    expect(record.issue(12).labels.map((l) => l.name)).toEqual(["answered"]);
    const first = record.comments(12).find((c) => c.id === ids[0]);
    expect(first?.body).toBe("Working on it.");
    // An edit made in the same breath as other writes, and one that fails rejects.
    await record.together([{ w: "editComment", id: ids[0] as number, body: "Done." }]);
    expect(record.comments(12).find((c) => c.id === ids[0])?.body).toBe("Done.");
    await expect(record.together([{ w: "editComment", id: 999999, body: "x" }])).rejects.toThrow();
    // A reaction or a label already gone is no failure: best effort, as the single writes are.
    await expect(record.together([{ w: "unlabel", n: 12, name: "never-there" }])).resolves.toEqual(
      [],
    );
  });

  it("opens and closes a task, and tells its state without reading it all", () => {
    const { record } = make();
    record.updateIssue(12, { state: "closed", state_reason: "completed" });
    expect(record.issueState(12)).toBe("closed");
    record.updateIssue(12, { state: "open" });
    expect(record.issueState(12)).toBe("open");
  });

  it("opens a split's parts as sub-issues with their links, once, and reads the family (ADR 0066)", () => {
    const { record } = make();
    // A task with no parts has no family: plan reads none.
    expect(record.family(12)).toBeUndefined();
    const label = { name: "sub-task", color: "8250df", description: "A part" };
    const parts = [
      { title: "shipify: a field", body: "Part of #12\n\nAdd it.", after: [], waits: [] },
      { title: "links: use it", body: "Part of #12\n\nUse it.", after: [0], waits: [] },
    ];
    expect(record.openParts(12, parts, label)).toEqual([200, 201]);
    const fam = record.family(201);
    expect(fam?.parent).toMatchObject({ number: 12, title: "make it faster", state: "open" });
    expect(fam?.parts.map((p) => [p.number, p.title, p.state, p.labels])).toEqual([
      [200, "shipify: a field", "open", ["sub-task"]],
      [201, "links: use it", "open", ["sub-task"]],
    ]);
    expect(fam?.parts[1]?.blockedBy).toEqual([{ number: 200, state: "open" }]);
    // The parent reads the same family.
    expect(record.family(12)?.parts.map((p) => p.number)).toEqual([200, 201]);
    // Asked again (a run that died between its calls): none opens twice, and no link is added twice.
    expect(record.openParts(12, parts, label)).toEqual([200, 201]);
    expect(record.family(12)?.parts[1]?.blockedBy).toHaveLength(1);
    // A closed part reads with how it closed, and its PR.
    fake.set((f) => {
      const p = f.others?.["200"]?.issue as Record<string, unknown>;
      Object.assign(p, {
        state: "closed",
        state_reason: "completed",
        pr: "https://github.com/o/shipify/pull/7",
      });
    });
    expect(record.family(201)?.parts[0]).toMatchObject({
      state: "closed",
      reason: "completed",
      pr: "https://github.com/o/shipify/pull/7",
    });
    expect(record.family(201)?.parts[1]?.blockedBy).toEqual([
      { number: 200, state: "closed", reason: "completed" },
    ]);
  });

  it("reads the closed chats past the first 100, a page a call, so a clean-up missed for weeks catches up", () => {
    const { record } = make();
    fake.set((f) => {
      f.others = Object.fromEntries(
        Array.from({ length: 150 }, (_, i) => {
          const n = 100 + i;
          const at = `2026-09-${String(5 + (i % 20)).padStart(2, "0")}T10:00:00Z`;
          return [
            String(n),
            {
              issue: {
                number: n,
                title: `task ${n}`,
                body: "",
                state: "closed",
                closed_at: at,
                updated_at: at,
                labels: [],
                user: { login: "owner" },
              },
              comments: [],
            },
          ];
        }),
      );
    });
    const read = record.sweep({
      closedFrom: "2026-09-03",
      closedTo: "2026-10-03",
      quietBefore: "2026-08-04",
      quietWithout: [],
    });
    expect(read.closed).toHaveLength(150);
    expect(new Set(read.closed.map((i) => i.number)).size).toBe(150);
  });

  it("reads what the weekly clean-up needs in one read, and a closed project's chats and pages (ADR 0069)", () => {
    const { record } = make();
    const at = (n: number, over: Record<string, unknown>) => ({
      issue: {
        number: n,
        title: `task ${n}`,
        body: "",
        state: "open",
        labels: [],
        user: { login: "owner" },
        ...over,
      },
      comments: [],
    });
    fake.set((f) => {
      Object.assign(f.issue, { updated_at: "2026-07-01T10:00:00Z" });
      f.others = {
        "40": at(40, {
          title: "Project: trip",
          labels: [{ name: "project" }],
          state: "closed",
          closed_at: "2026-09-20T10:00:00Z",
        }),
        "41": at(41, { parent: 40, state: "closed", closed_at: "2026-08-01T10:00:00Z" }),
        "42": at(42, { labels: [{ name: "library" }, { name: "project:trip" }] }),
        "43": at(43, { parent: 40 }),
        "44": at(44, { state: "closed", closed_at: "2026-09-05T10:00:00Z" }),
        "45": at(45, { updated_at: "2026-06-01T10:00:00Z" }),
        "46": at(46, { labels: [{ name: "needs you" }], updated_at: "2026-06-15T10:00:00Z" }),
        "50": at(50, { title: "Project: shop", labels: [{ name: "project" }] }),
        "51": at(51, { parent: 50, state: "closed", closed_at: "2026-09-25T10:00:00Z" }),
        "60": at(60, { updated_at: "2026-07-15T10:00:00Z", pr: "https://x/pull/1" }),
        "61": at(61, { parent: 60, updated_at: "2026-10-30T10:00:00Z" }),
      };
    });
    const read = record.sweep({
      closedFrom: "2026-09-03",
      closedTo: "2026-10-03",
      quietBefore: "2026-08-04",
      quietWithout: ["project", "needs you"],
    });
    // The oldest first, so a missed week catches up before they leave the window.
    expect(read.closed.map((i) => [i.number, i.closedAt, i.parent?.number])).toEqual([
      [44, "2026-09-05T10:00:00Z", undefined],
      [40, "2026-09-20T10:00:00Z", undefined],
      [51, "2026-09-25T10:00:00Z", 50],
    ]);
    expect(read.closed[2]?.parent).toEqual({ number: 50, state: "open", labels: ["project"] });
    expect(read.projects.map((i) => [i.number, i.title])).toEqual([[50, "Project: shop"]]);
    // The oldest first too, and none with a label the 30-day close leaves open (#46).
    expect(read.quiet.map((i) => [i.number, i.openParts, i.openPrs])).toEqual([
      [45, 0, 0],
      [12, 0, 0],
      [60, 1, 1],
    ]);
    // Each chat with its state: only a closed one's files go with its project (ADR 0069).
    expect(record.projectItems(40, "project:trip")).toEqual({
      chats: [
        { number: 41, state: "closed" },
        { number: 43, state: "open" },
      ],
      pages: [42],
    });
    // The weekly digest's one read (ADR 0070): the open projects with their chats, and the open
    // Inbox pages with their items.
    fake.set((f) => {
      f.others ??= {};
      f.others["52"] = at(52, { parent: 50, labels: [{ name: "needs you" }] });
      f.others["53"] = {
        ...at(53, {
          title: "Notebook: shop-inbox",
          labels: [{ name: "library" }, { name: "project:shop" }],
          body: "Collated up to item 9 (1 items).",
        }),
        comments: [
          { id: 9, body: "a find", user: { login: "owner" }, created_at: "2026-10-01T10:00:00Z" },
        ],
      };
    });
    const live = record.liveProjects();
    expect(live.projects.map((p) => [p.number, p.title])).toEqual([[50, "Project: shop"]]);
    expect(live.projects[0]?.chats.map((c) => [c.number, c.state, c.labels])).toEqual([
      [51, "closed", []],
      [52, "open", ["needs you"]],
    ]);
    expect(live.inboxes).toEqual([
      { title: "Notebook: shop-inbox", body: "Collated up to item 9 (1 items).", items: 1 },
    ]);
  });

  it("reads a task's comments and the task again only when they changed (ADR 0057)", () => {
    const { record } = make();
    const since = "2026-01-01T00:00:00Z";
    const first = record.commentsIfChanged(12, since);
    expect(first.comments).toEqual([]);
    expect(first.tag).toEqual(expect.any(String));
    // Nothing changed: no comments, the same tag, and nothing to pay.
    expect(record.commentsIfChanged(12, since, first.tag)).toEqual({ tag: first.tag });
    record.comment(12, "and the disk?");
    const next = record.commentsIfChanged(12, since, first.tag);
    expect(next.comments?.map((c) => c.body)).toEqual(["and the disk?"]);
    expect(next.tag).not.toBe(first.tag);
    const issue = record.issueIfChanged(12);
    expect(issue.issue?.state).toBe("open");
    expect(record.issueIfChanged(12, issue.tag)).toEqual({ tag: issue.tag });
    record.updateIssue(12, { state: "closed", state_reason: "completed" });
    expect(record.issueIfChanged(12, issue.tag).issue?.state).toBe("closed");
  });

  it("says whether a job waits for a machine with a label, never counting a run with no job (ADR 0057)", () => {
    const { queue } = make();
    expect(queue.waitingFor(["shipify-box"]).waiting).toBe(false);
    fake.set((f) => {
      Object.assign(f, {
        queued: [
          { id: 7, jobs: [] },
          { id: 8, jobs: [{ status: "queued", labels: ["ubuntu-latest"] }] },
        ],
      });
    });
    const none = queue.waitingFor(["shipify-box"]);
    expect(none.waiting).toBe(false);
    fake.set((f) => {
      Object.assign(f, {
        queued: [
          {
            id: 9,
            jobs: [
              {
                status: "queued",
                labels: ["self-hosted", "shipify-box"],
                created_at: "2026-10-15T12:00:05Z",
              },
            ],
          },
          {
            id: 10,
            jobs: [
              {
                status: "queued",
                labels: ["self-hosted", "shipify-box"],
                created_at: "2026-10-15T12:00:01Z",
                run_id: 10,
              },
            ],
          },
        ],
      });
    });
    // Waiting, and since when the longest-waiting job was queued: which stay gives way first.
    expect(queue.waitingFor(["shipify-box"], none.tag)).toMatchObject({
      waiting: true,
      since: "2026-10-15T12:00:01Z",
      run: 10,
    });
  });

  it("counts a box's own clean-up for that box alone (ADR 0057)", () => {
    const { queue } = make();
    fake.set((f) => {
      Object.assign(f, {
        queued: [
          {
            id: 11,
            jobs: [
              {
                status: "queued",
                labels: ["self-hosted", "box-homepi"],
                created_at: "2026-10-15T12:00:00Z",
              },
            ],
          },
        ],
      });
    });
    expect(queue.waitingFor(["shipify-box", "box-homepi"]).waiting).toBe(true);
    expect(queue.waitingFor(["shipify-box", "box-vps"]).waiting).toBe(false);
  });

  it("opens an issue, and pins and unpins it without failing when it can't", () => {
    const { record } = make();
    const made = record.createIssue({
      title: "Shipify status",
      body: "x",
      labels: ["shipify-status"],
    });
    expect(made.number).toBeGreaterThan(0);
    expect(() => record.pin(made)).not.toThrow();
    expect(() => record.unpin(made)).not.toThrow();
  });

  it("reacts and reads rendered HTML without failing a round", () => {
    const { record } = make();
    expect(() => record.react({ issue: 12 }, "eyes")).not.toThrow();
    const r = record.rendered(12);
    expect(typeof r.body).toBe("string");
    expect(Array.isArray(r.comments)).toBe(true);
  });

  it("starts a run, and says why when it couldn't", () => {
    const { queue } = make();
    expect(queue.dispatch("task.yml", { issue: "12", reason: "act" })).toEqual({ ok: true });
    expect(fake.read().calls).toContain(
      "workflow run task.yml -R o/shipify -f issue=12 -f reason=act",
    );
    fake.set((f) => {
      f.noDispatch = true;
    });
    const failed = queue.dispatch("task.yml", { issue: "12" });
    expect(failed.ok).toBe(false);
    expect("error" in failed && failed.error).toMatch(/500/);
  });

  it("lists what's queued or running, and a workflow's recent runs", () => {
    const { queue } = make();
    expect(queue.active()).toEqual([]);
    expect(queue.runs("watch.yml", 5).map((r) => r.display_title)).toEqual(["due"]);
  });
});
