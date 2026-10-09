// The core's data (ADR 0031): a snapshot of a task, read once, and the writes a run makes. Plain
// values, so decide is tested as `snapshot → writes` with no GitHub.
import type { From, Link, Problem, ReplyKind, ToolCall } from "../contracts/index.ts";
import type { FormRead } from "../lib/form-reader.ts";
import type { RepoRef } from "../lib/projects-on-github.ts";
import type { TaskState, TaskTitle } from "../lib/task.ts";
import type { Result } from "./result.ts";

/** Who wrote a comment, as the record proves it (never as its text claims). */
export type Author = "owner" | "door" | "run" | "other";

export interface Said {
  id: number;
  author: Author;
  /** The words, without any hidden first line. */
  text: string;
  at: string;
  /** Changed after it was written (a `yes` must be unedited). */
  edited: boolean;
  /** Where it came from: "github", or the chat the door names in its `from` line. */
  channel: string;
  from?: From;
}

/** What started this run. */
export type Trigger =
  | { kind: "opened" | "edited" | "closed" | "reopened" | "comment" }
  | { kind: "dispatch"; job: "run" | "github" };

export interface Snapshot {
  n: number;
  issue: {
    title: string;
    body: string;
    state: "open" | "closed";
    stateReason?: string | null;
    closedAt?: string | null;
    labels: string[];
    /** Opened by you, by the door for you, or someone else. */
    author: Author;
    from?: From;
    isPr: boolean;
  };
  said: Said[];
  state: TaskState;
  statusId?: number;
  trigger: Trigger;
  now: string;
  run: { id: string; url?: string };
  parsed: TaskTitle;
  form?: FormRead;
  /** The Repeat form's answers, when it's one. */
  repeatForm?: { what: string; when: string; kind: "reminder" | "agent" | "check"; check?: string };
  /** The model the task starts with: its form's Model field, or a first line `use <model>`. */
  firstUse?: string;
  /** The body's hash now: a change counts as new. */
  bodyHash: string;
  /** Known projects (the org's repos Shipify manages). */
  projects: string[];
  /** Every repo a task can name (ADR 0044): the projects and your other repos, with their sizes. */
  repos: RepoRef[];
  /**
   * The account the task works on besides Shipify's own (ADR 0045), and whether the repos App
   * reached it (plan's token for it was minted, and its repos read). None: Shipify's own.
   */
  account?: { login: string; reached: boolean; why?: string };
  /**
   * Your accounts (ADR 0045): Shipify's own (`own`), the others you've added (`listed`), and the
   * repos App's name on GitHub (`app`), when it's set up. None off a box.
   */
  accounts?: { own: string; listed: string[]; app?: string };
  /** What GitHub said of each `owner/name` the task's words look at that isn't yours (ADR 0044):
   * a public repo (its name as GitHub has it, and its size), or the status it answered with. Read
   * once by plan, so a word that names no repo (a file's path, `and/or`) is only a word. */
  looked?: Record<string, { repo: string; sizeKB: number } | { status: number }>;
  /** The status issue/notebook guards came first; this is a real task. */
  isTask: boolean;
}

/** What the agent may touch (docs/glossary.md): talk (answers, your projects on demand), work (one
 * repo's clone, on the task's branch), read (only the repos it was given, files only: ADR 0044). */
export type Profile = "talk" | "work" | "read";

/** A repo a run reads (ADR 0044): cloned at depth 1 into its read/ folder before the agent starts. */
export interface Read {
  /** Yours: the project's id or the repo's name. Anyone else's: owner/name. */
  name: string;
  /** Its repo, `owner/name`. */
  repo: string;
  /** In your account (the App's installation): cloned with the run's key. Else anonymously, and
   * the run is in the read profile. */
  mine: boolean;
  /** GitHub's size (KB): the packed history, so the most its clone downloads. */
  sizeKB: number;
}

/** Why a think happens: the agent's prompt says it in a line. */
export type ThinkWhy =
  | "new"
  | "comment"
  | "continue"
  | "start-over"
  | "go"
  | "publish"
  | "work"
  | "scheduled"
  | "edited";

export interface Think {
  profile: Profile;
  /** The project, or another repo of yours, a work run changes. */
  project?: string;
  /** A work run's repo isn't a project (ADR 0044): it keeps its own rules (its docs, commands and
   * CI), so the box runs no project checks on it and adds nothing of Shipify's. */
  ownRules?: true;
  /** The repos this run reads, named by `look at` in the task's words (ADR 0044). */
  reads?: Read[];
  /**
   * The account it works on besides Shipify's own (ADR 0045): it holds that repo's key and
   * Shipify's rules, and none of the tools' keys, the owner's other repos, or the notebook but that
   * repo's own page (ADR 0047).
   */
  account?: string;
  /** A repo's default branch, when it isn't `main` (ADR 0045): its clone, its PR's base. */
  base?: string;
  /**
   * Why the name the task asks a change on was refused (ADR 0045: an account you haven't added, a
   * repo the repos App doesn't reach, a repo on another account): on the task's first run, plan
   * says it itself, with the fix, and no agent runs.
   */
  refused?: string;
  why: ThinkWhy;
  /** Lines for the agent: what the box worked out before it (unknown project, refresh conflicts). */
  notes: string[];
  /** The comments this run answers. */
  fresh: number[];
  /** A repeat's due time, a deploy's sha: part of the reply's key. */
  occasion?: string;
  web: boolean;
  /** A repeat's check: its script runs (as the agent's user, no keys) instead of the agent. */
  check?: string;
  /** After the check, the agent too, when its output changed from this (a recipe with a check, a
   * repeat that thinks on a change): what the check said goes in its notes. */
  thenAsk?: { was?: string };
  /** A recipe's run: its body, as merged on main, is what the agent is asked. */
  recipe?: { name: string; body: string };
}

/** Why the agent stopped before its answer: its clock, your plan's limit, a crash, an answer that
 * didn't read, or your `stop` (that comment). A crash or no answer carries what the agent ended on,
 * when it said (its model's last error, in its words), and the model that said it. */
export type Stop =
  | { why: "clock"; minutes: number }
  | { why: "plan"; window: string; resets?: string }
  | { why: "crash"; code: number; error?: AgentError }
  | { why: "no-answer"; error?: AgentError }
  | { why: "asked"; comment: number };

/** An agent's last error: the model ("Sonnet", "glm-5.3-flash at openrouter.ai") and its words. */
export interface AgentError {
  by: string;
  said: string;
}

/** What the box saw of a think (meta.json), beside the agent's own result. */
export interface ThinkMeta {
  readOutside: boolean;
  touchesWorkflows: boolean;
  checkOutput?: string;
  checkHash?: string;
  /** The agent stopped before its answer. */
  stopped?: Stop;
  /** Your comments written while it worked that it took in before it answered: this run's too. */
  caughtUp?: number[];
  /** Its commits are in work.bundle. */
  commits?: boolean;
  /** Its repo has no main yet: those commits would be a new project's first push. */
  firstPush?: boolean;
  /** Its handoff for the next run (out/handoff.md, ADR 0041), however the run ended. */
  handoff?: string;
}

/** One change a run makes, as data; apply makes it, each safe to repeat. */
export type Write =
  | {
      w: "reply";
      kind: ReplyKind;
      state: string;
      text: string;
      question?: string;
      /** Short answers to the question, as buttons where a chat can. */
      choices?: string[];
      links?: Link[];
      files?: string[];
      problem?: Problem;
      step: string;
      occasion?: string;
      /** From a run that read outside content (ADR 0044): its images are made inert before it's
       * posted, as GitHub's image proxy would fetch them, and a URL can carry data. */
      outside?: true;
    }
  | { w: "labels"; add?: string[]; remove?: string[] }
  /** `forget: …`: the one note holding these words, taken off its page by the box. */
  | { w: "forget"; words: string }
  | { w: "close"; reason?: "completed" | "not_planned" }
  | { w: "reopen" }
  | { w: "note"; topic: string; line: string }
  | { w: "calls"; calls: ToolCall[]; fingerprint: string }
  | {
      w: "push";
      repo: string;
      branch: string;
      kind: "closes" | "part-of" | "publish";
      title: string;
      body: string;
      preview?: boolean;
      /** A repo's default branch, when it isn't `main` (ADR 0045): the PR's base. */
      base?: string;
      open?: undefined;
    }
  /**
   * Kept work: a failed or stopped run's commits wait on the task's branch, and no PR opens.
   * `quiet`: a question's (ADR 0041), whose reply it never changes; a push that fails is logged.
   */
  | {
      w: "push";
      repo: string;
      branch: string;
      open: false;
      kind?: undefined;
      quiet?: true;
      base?: string;
    }
  | { w: "preview"; repo: string; pr: string }
  | { w: "dispatch"; job: "run" | "github" }
  | { w: "coming-up" }
  | { w: "react"; comment: number; content: "eyes" | "+1" };

/** What plan decided: nothing, the box alone, a think first, or the github job's work. */
export type Plan =
  | { do: "nothing"; why: string; state?: TaskState }
  | { do: "box"; writes: Write[]; state: TaskState; why: string }
  /** `writes`: what the box makes anyway (a note, a command's answer), applied before the agent's. */
  | { do: "think"; think: Think; state: TaskState; why: string; writes?: Write[] }
  | { do: "github"; job: "operate" | "prepare" | "close-prs"; state: TaskState; why: string };

/** What a think's result became: the writes, and what the run needs minted for them. */
export interface Decided {
  writes: Write[];
  state: TaskState;
  needs: { repo?: string; act?: string; workflows?: boolean };
}

export type { Result };
