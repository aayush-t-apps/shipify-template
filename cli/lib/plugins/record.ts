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
}

export interface RecordLabel {
  name: string;
  color: string;
  description: string;
}

export type Reaction = "eyes" | "+1";

export interface IssueQuery {
  state?: "open" | "closed" | "all";
  labels?: string[];
  /** Only the newest this many, by when each was opened (one page: no paging through all). */
  newest?: number;
}

export interface IssuePatch {
  state?: "open" | "closed";
  state_reason?: "completed" | "not_planned";
  title?: string;
  body?: string;
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
  /** Kept on top of the list, when the record and the key allow. Best effort. */
  pin(issue: RecordIssue): void;
  /**
   * The issues with this label (open ones, or all), oldest first, 100 at most, each with who opened
   * it and who last edited its text. What the core trusts (a notebook page) it
   * reads this way: a body the agent's token edited counts for nothing (ADR 0027).
   */
  pages(label: string, state?: "open" | "all"): RecordPage[];
  /** Who opened an issue and who last edited its text. */
  writers(n: number): { author: string; editor?: string };
  /**
   * Who wrote a comment and who last edited its text (ADR 0031: a status comment counts only when
   * a run wrote it and no one else edited it since). The ghost when unknown.
   */
  commentWriters(comment: { id: number; node_id?: string }): { author: string; editor?: string };
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
}
