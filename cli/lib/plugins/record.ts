// The record plug-in's contract (ADR 0027, docs/plug-ins.md). The record keeps tasks and their
// conversation; the queue turns an event into a run on a machine. GitHub is both today
// (lib/github.ts: githubRecord, githubQueue). The core reaches tasks and runs only through these
// two interfaces, so another record (Forgejo, GitLab) is a port of one file, held to the same
// conformance test (tests/plugins/record.test.ts). The rest of what lives on GitHub (PRs,
// branches, runners, variables) goes through lib/github.ts's calls, and joins this contract when a
// second record needs it.

/** An issue: a task, the status task, a notebook page. */
export interface RecordIssue {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  state_reason?: string | null;
  closed_at?: string | null;
  created_at?: string;
  labels: { name: string }[];
  user: { login: string };
  /** Set when the record lists a pull request as an issue: never a task. */
  pull_request?: unknown;
  /** The record's own id for it, for calls that take one (pinning). */
  node_id?: string;
  /** Its sub-issues (ADR 0066): how many, and how many are closed. None: the record has none. */
  sub_issues_summary?: { total: number; completed: number };
}

/** A part of a split task (ADR 0066): one of its sub-issues, and what it waits for. */
export interface RecordPart {
  number: number;
  title: string;
  state: "open" | "closed";
  /** How it closed, as the record says it: "completed", "not_planned", "duplicate". */
  reason?: string;
  labels: string[];
  /** The issues it's blocked by, each with how it stands. */
  blockedBy: { number: number; state: "open" | "closed"; reason?: string }[];
  /** The PR that closed it, when one did. */
  pr?: string;
}

/** An issue above another: a split's parent, or a project (ADR 0069). */
export interface RecordAbove {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
}

/**
 * A task's family in one read (ADR 0066, 0069): the parent is the task, or the one it's under,
 * with that one's sub-issues (100 at most, as GitHub allows). For a task that has a parent and
 * sub-issues of its own (a chat in a project, split), its own too; and the parent's parent (a
 * project above a split chat's part).
 */
export interface RecordFamily {
  parent: RecordAbove;
  parts: RecordPart[];
  own?: RecordPart[];
  above?: RecordAbove;
}

/** A part to open (ADR 0066): its words, and what it waits for. */
export interface NewPart {
  title: string;
  body: string;
  /** The parts before it in the same list it waits for, by their place (0 is the first). */
  after: number[];
  /** The parent's parts that exist already, by number, it waits for. */
  waits: number[];
}

export interface RecordComment {
  id: number;
  body: string;
  user: { login: string };
  created_at: string;
  /** When its text last changed: the same as created_at for one never edited. */
  updated_at?: string;
  /** The record's own id for it, for calls that take one (who edited it). */
  node_id?: string;
}

/** An issue with who opened it and who last changed its text (a notebook page). */
export interface RecordPage {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: { name: string }[];
  url?: string;
  /** As the record names them; editor is none for one never edited. */
  author: string;
  editor?: string;
  /** When its text last changed: its last edit, or when it was made (ADR 0070). A comment on it
   * (an Inbox's item) changes nothing here. */
  editedAt?: string;
}

export interface RecordLabel {
  name: string;
  color: string;
  description: string;
}

export type Reaction = "eyes" | "+1";

/**
 * One of the record's own writes (ADR 0051 B3), to make together with the rest: a reaction, a
 * label on or off an issue, a comment written or edited. Safe to repeat, and needing no order
 * among themselves.
 */
export type RecordWrite =
  | { w: "react"; on: { issue: number } | { comment: number }; content: Reaction }
  | { w: "labels"; n: number; names: string[] }
  | { w: "unlabel"; n: number; name: string }
  | { w: "comment"; n: number; body: string }
  | { w: "editComment"; id: number; body: string };

export interface IssueQuery {
  state?: "open" | "closed" | "all";
  labels?: string[];
  /** Only the newest this many, by when each was opened (one page: no paging through all). */
  newest?: number;
  /** Only those updated at or after this time (ISO 8601): the weekly digest's week. */
  since?: string;
}

export interface IssuePatch {
  state?: "open" | "closed";
  state_reason?: "completed" | "not_planned";
  title?: string;
  body?: string;
}

/** An issue as the weekly clean-up reads it (ADR 0069). */
export interface SweptIssue {
  number: number;
  title: string;
  labels: string[];
  /** When it closed, for a closed one. */
  closedAt?: string;
  /** Its last change: a word on it, or a label (a clean start's list keeps what changed since). */
  updatedAt?: string;
  /** The issue it's a sub-issue of: a project's, for a chat in one; a split's, for a part. */
  parent?: { number: number; state: "open" | "closed"; labels: string[] };
  /** Its open sub-issues. */
  openParts: number;
  /** Its open PRs that close it. */
  openPrs: number;
}

/** The weekly clean-up's one read (ADR 0069): 100 at most each, the rest the next week. */
export interface SweepRead {
  /** Closed on a day from `closedFrom` to `closedTo`, both in; the oldest first. */
  closed: SweptIssue[];
  /** Open, and labelled `project`. */
  projects: SweptIssue[];
  /**
   * Open, with no word or change since before `quietBefore`, and none of `quietWithout`'s labels;
   * the oldest first.
   */
  quiet: SweptIssue[];
}

/** A project's chats and pages, as the weekly clean-up reads them (ADR 0069). */
export interface ProjectItems {
  /** Its sub-issues: an open one is still yours, so it keeps its files. */
  chats: { number: number; state: "open" | "closed" }[];
  /** The issues with its `project:<name>` label, open or closed. */
  pages: number[];
}

/** An open project as the weekly digest reads it (ADR 0070): its number, title and chats. */
export interface LiveProject {
  number: number;
  title: string;
  /** Its sub-issues, 100: each one's state, labels and last change. */
  chats: { number: number; state: "open" | "closed"; labels: string[]; updatedAt: string }[];
}

export interface TaskRecord {
  /** Which record this is: "github". */
  readonly id: string;
  issue(n: number): RecordIssue;
  /** Open issues by default; with labels, those that have every one. */
  issues(query?: IssueQuery): RecordIssue[];
  createIssue(issue: {
    title: string;
    body: string;
    labels?: string[];
    /** Who it's assigned to: they hear of every new comment on it. */
    assignees?: string[];
  }): RecordIssue;
  updateIssue(n: number, patch: IssuePatch): void;
  /** An issue's state without reading all of it; "gone" when it was deleted. */
  issueState(n: number): "open" | "closed" | "gone" | "unknown";
  /** Every comment, oldest first; with `since`, only those written or edited since then. */
  comments(n: number, since?: string): RecordComment[];
  /**
   * As `comments(n, since)`, only when anything changed since the answer `tag` names (ADR 0057: a
   * run that stays reads its task every few seconds): unchanged is `{ tag }` with no comments, and
   * costs the record nothing. The first read has no tag.
   */
  commentsIfChanged(
    n: number,
    since: string,
    tag?: string,
  ): { tag?: string; comments?: RecordComment[] };
  /** As `issue(n)`, only when it changed since `tag`: unchanged is `{ tag }` with no issue. */
  issueIfChanged(n: number, tag?: string): { tag?: string; issue?: RecordIssue };
  /**
   * The issue's and its comments' rendered HTML: where pasted images and attached files show as
   * links the record signs. With `since`, only the comments written or edited since then (and no
   * body).
   */
  rendered(
    n: number,
    since?: string,
  ): {
    body: string;
    comments: { id: number; created_at: string; html: string }[];
  };
  /** A new comment; its id. */
  comment(n: number, body: string): number;
  editComment(id: number, body: string): void;
  /** Best effort: false when it couldn't. */
  deleteComment(id: number): boolean;
  /** Every label's name. */
  labels(): string[];
  /** Made, or updated to this colour and description. Best effort. */
  makeLabel(label: RecordLabel): void;
  addLabels(n: number, names: string[]): void;
  /** Best effort. */
  removeLabel(n: number, name: string): void;
  /** Best effort. */
  react(on: { issue: number } | { comment: number }, content: Reaction): void;
  /**
   * The record's own writes, started together (ADR 0051 B3): each made as itself, none waiting
   * for another. `react` and `unlabel` stay best effort; the rest reject when they fail. The new
   * comments' ids, in the order asked.
   */
  together(writes: RecordWrite[]): Promise<number[]>;
  /** Kept on top of the list, when the record and the key allow. Best effort. */
  pin(issue: RecordIssue): void;
  /** Off the top of the list. Best effort. */
  unpin(issue: RecordIssue): void;
  /**
   * The issues with this label (open ones, or all), oldest first, 100 at most, each with who opened
   * it and who last edited its text. What the core trusts (a notebook page) it
   * reads this way: a body the agent's token edited counts for nothing (ADR 0027).
   */
  pages(label: string, state?: "open" | "all"): RecordPage[];
  /** Who opened an issue and who last edited its text. */
  writers(n: number): { author: string; editor?: string };
  /**
   * The family a task is in (ADR 0066), in one read: its parent and their parts when it's a part,
   * or itself and its parts when it has some. None for a task with neither.
   */
  family(n: number): RecordFamily | undefined;
  /**
   * Parts opened as sub-issues of `parent` (ADR 0066), each with the label and its blocked-by
   * links: the parent's ids read, the parts made, then the links. A part whose title is one of the
   * parent's parts already is that one, not opened again. Their numbers, in the order asked.
   */
  openParts(parent: number, parts: NewPart[], label: RecordLabel): number[];
  /**
   * Who wrote a comment and who last edited its text (ADR 0031: a status comment counts only when
   * a run wrote it and no one else edited it since). The ghost when unknown.
   */
  commentWriters(comment: { id: number; node_id?: string }): { author: string; editor?: string };
  /**
   * What the weekly clean-up reads (ADR 0069), in one read: the issues closed in a window of days,
   * the open projects, and the open issues quiet since a day with none of the labels it leaves open
   * (`quietWithout`), each with its labels, its parent and what it has open. Days as YYYY-MM-DD.
   * Pull requests are none of them.
   */
  sweep(q: {
    closedFrom: string;
    closedTo: string;
    quietBefore: string;
    quietWithout: string[];
  }): SweepRead;
  /**
   * A project's chats (its sub-issues), each with its state, and pages (the issues with its
   * `project:<name>` label, open or closed), 100 each, in one read (ADR 0069).
   */
  projectItems(n: number, label: string): ProjectItems;
  /**
   * What the weekly digest says of your projects (ADR 0070), in one read: the open projects (50)
   * with their chats, and the open Inbox pages (50), each with its text and how many items
   * (comments) it has.
   */
  liveProjects(): {
    projects: LiveProject[];
    inboxes: { title: string; body: string; items: number }[];
  };
  /**
   * A task in one read (ADR 0069, a run's start-up reads): the issue as `issue(n)` gives it, and
   * every comment as `comments(n)` does, each with who last edited its text (none for one never
   * edited), as `commentWriters` says it.
   */
  task(n: number): { issue: RecordIssue; comments: (RecordComment & { editor?: string })[] };
}

/** One run in the queue, as the record shows it. */
export interface QueueRun {
  /** Its id and link, when the queue gives them. */
  id?: number;
  html_url?: string;
  status: string;
  conclusion: string | null;
  /** Its name: "task #12", "due", "cleanup mybox". */
  display_title: string;
  created_at: string;
}

export interface Queue {
  /** A run of a workflow, with these inputs. */
  dispatch(
    workflow: string,
    inputs: Record<string, string>,
  ): { ok: true } | { ok: false; error: string };
  /** The names of every run queued or under way. */
  active(): string[];
  /** A workflow's recent runs, newest first. */
  runs(workflow: string, count?: number): QueueRun[];
  /**
   * Whether a job waits for a machine with any of these labels (ADR 0057: a run that stays gives
   * its slot to it: a task's run, or its own box's clean-up). A run held back behind its task's own
   * run has no job yet, so it never counts. Read only when the queue changed since `tag`:
   * unchanged, it says nothing new waits. `since`: when the longest waiting job was queued, and
   * `run`: its run.
   */
  waitingFor(
    labels: string[],
    tag?: string,
  ): { tag?: string; waiting: boolean; since?: string; run?: number };
}
