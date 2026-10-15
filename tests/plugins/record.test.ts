// The record plug-in's conformance test (ADR 0027, cli/lib/plugins/record.ts): every record and
// queue Shipify can use passes the same suite. GitHub runs here against the fake gh
// (tests/fixtures/fake-gh.mjs). A new record (Forgejo, say) joins RECORDS with its own fake.
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { githubQueue, githubRecord } from "../../cli/lib/github.ts";
import type { Queue, TaskRecord } from "../../cli/lib/plugins/record.ts";
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

  it("opens an issue, and pins it without failing when it can't", () => {
    const { record } = make();
    const made = record.createIssue({
      title: "Shipify status",
      body: "x",
      labels: ["shipify-status"],
    });
    expect(made.number).toBeGreaterThan(0);
    expect(() => record.pin(made)).not.toThrow();
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
