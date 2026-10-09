// The agent plug-in's contract (ADR 0017, ADR 0027, docs/plug-ins.md). An entry in executors.json
// says how to start an agent; an adapter (agents/<adapter>.ts) turns the core's one ask into that
// agent's own flags and reads back what it did. The core asks every agent for the same things and
// reads the same report:
//   in:  the prompt (on stdin, or as {promptText}), a model and an effort, and the run's tools
//   out: the result file (playbooks/task.md), and a report: the model used, tokens, tools, limits
// An agent without an adapter still runs from its command (its `flags` set a model and an effort),
// with no tools and a report of its time alone. Which models and efforts it takes is data here, so
// a new model or agent never needs code. Every adapter passes tests/plugins/agent.test.ts.
import { z } from "zod";
import type { Mode } from "../tools.ts";

/** What an adapter may use to hand its agent the run's look tools: the tools library, through here
 * only, so an adapter imports nothing of the core but its contract (tests/architecture.test.ts). */
export { command, loadTools, type Mode, runTools, secretFor, type Tools } from "../tools.ts";

import type { Tools } from "../tools.ts";

/** The tools a run offers its agent (AgentRun.tools.only): those named, or all when it names none. */
export const offered = (all: Tools, only?: string[]): Tools =>
  only ? Object.fromEntries(Object.entries(all).filter(([name]) => only.includes(name))) : all;

/** executors.json's version: an optional top-level "version"; a file without one is version 1. */
export const EXECUTORS_VERSION = 1;

/** executors.json's names that aren't agents: its version, and what every agent shares. */
export const SHARED_KEYS = ["version", "commands", "gateways"] as const;

/**
 * What every agent must never run (ADR 0043, amending ADR 0038's "One setup"), said once as plain
 * prefixes: `git push`, `git stash`. Any other command runs: the walls are outside the agent (its
 * own Linux user, read-only keys, every process killed at the end, the box's own push). `deny`
 * covers every part of a command (`make && git push`, `$(git stash)`) and the command after git's
 * own options (`git -C x push`). `web`: it may read the web with its own tools. Each adapter writes
 * this as its agent's rules; a project's files never widen it. There's no allow list: one left in
 * executors.json is named as a problem (readExecutors), never read.
 * `run: false` is the read profile (ADR 0044), which the core sets for a run that reads a repo
 * outside your account (executors.json never does): no command at all, no web, no tool's calls,
 * files read only in its working folder and its read folders, and nothing written. Its answer comes
 * back as its final message in the result's shape.
 */
export const Commands = z.object({
  description: z.string().optional(),
  deny: z.array(z.string().min(1)),
  web: z.boolean(),
  run: z.boolean().optional(),
});
export type Commands = z.infer<typeof Commands>;

/**
 * Where models are served (ADR 0038, "Gateways"): its address, how it's spoken to, and the secret
 * that holds its key, also the variable the agent reads it from. `check`, on the address, answers
 * 200 for a good key (`ship add <gateway>`).
 */
export const Gateway = z.object({
  description: z.string(),
  url: z.string().url(),
  protocol: z.enum(["openai-chat", "openai-responses", "anthropic-messages"]),
  key: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  how: z.string(),
  check: z.string().startsWith("/").optional(),
  /**
   * Its own list of models, searched with no key (`/models <word>`): a path with `{word}`, giving
   * the OpenAI shape (`{data: [{id}]}`). Without it, an agent's short names are its list.
   */
  search: z.string().startsWith("/").includes("{word}").optional(),
});
export type Gateway = z.infer<typeof Gateway>;

/** The box's shared tools that aren't an agent's: never an agent's install folder. */
export const RESERVED_DIRS = ["node", "shipify-app", "pnpm", "corepack"];

/**
 * How a box installs an agent (ADR 0038): its command, run once into `{prefix}` (the box's shared
 * tools, <dir>/<version>) the first time a run picks it, and its program there. Each word is
 * executors.json's, so any installer works; a version moves only in a PR that says so.
 */
export const Install = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  run: z.array(z.string().min(1)).min(1),
  /** Its program, from the prefix: "bin/pi". */
  bin: z.string().regex(/^[A-Za-z0-9._/-]+$/),
  /** Its folder in the box's shared tools; the agent's id when not said. Never one of the box's own. */
  dir: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._-]*$/)
    .refine((d) => !RESERVED_DIRS.includes(d), "is one of the box's own folders")
    .optional(),
});

export type Install = z.infer<typeof Install>;

/** One agent in executors.json, and how to hand it a prompt: {promptText}, {promptFile}, {cwd}. */
export const ExecutorEntry = z.object({
  description: z.string(),
  command: z.array(z.string()).optional(),
  /** Unattended task runs (ship task). Without {promptText}, the prompt goes on stdin. */
  task: z.array(z.string()).optional(),
  manual: z.boolean().optional(),
  /**
   * Its adapter (ADR 0017, cli/lib/agents/): its flags for a model, an effort and tools, and how
   * to read what it did. Without one it runs as a plain program.
   */
  adapter: z.string().optional(),
  /** Auto: the model and effort a run gets when no `use` line chooses (the agent's own names). */
  auto: z.object({ model: z.string().optional(), effort: z.string().optional() }).optional(),
  /** The models it takes by name ("use opus"), as the agent itself names them. */
  models: z.array(z.string()).optional(),
  /** Model ids it takes besides those (a regex): a new model works without an edit. */
  modelPattern: z.string().optional(),
  /** The efforts it takes, as the agent names them. None listed: it takes no effort setting. */
  efforts: z.array(z.string()).optional(),
  /** Models that take no effort setting. */
  noEffort: z.array(z.string()).optional(),
  /**
   * Without an adapter: how its command takes a model and an effort ({model}, {effort}). An
   * adapter adds its own.
   */
  flags: z
    .object({ model: z.array(z.string()).optional(), effort: z.array(z.string()).optional() })
    .optional(),
  /** The agent a task runs when nothing chooses one (the repo variable SHIPIFY_AGENT wins). */
  default: z.boolean().optional(),
  /** Its login on a box: the GitHub secret holding it, and how to make one (`ship box list`). */
  login: z.object({ secret: z.string().regex(/^[A-Z][A-Z0-9_]*$/), how: z.string() }).optional(),
  /**
   * The gateway its models are served by (executors.json's `gateways`); its key is the login. Its
   * `models` are then ids there ("z-ai/glm-5.3"), listed first; any other its pattern takes runs too.
   */
  gateway: z.string().optional(),
  /** A line about each listed model (`models`), for the web chat's picker: what it's for. */
  about: z.record(z.string(), z.string().max(80)).optional(),
  /** How a box installs it; without one, it isn't installed by the box. */
  install: Install.optional(),
});
export type Executor = z.infer<typeof ExecutorEntry>;
export type Executors = Record<string, Executor>;

/** Tokens, as every agent counts them: new input, input read from or written to a cache, output. */
export interface Tokens {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  /** Output spent thinking, when the agent says. */
  thinking?: number;
}

/** What the core asks of an agent for one run. */
export interface AgentRun {
  /** The executors.json command for unattended runs. */
  command: string[];
  /** The agent's own names for the model and the effort, when they're set. */
  model?: string;
  effort?: string;
  /**
   * The run's tools (ADR 0015, ADR 0031: look calls only, the agent never acts), and the folder
   * its settings are written to (the run hands the agent a copy).
   */
  tools?: {
    mode: Mode;
    dir: string;
    /** Where the tools' servers are: a read-only copy of Shipify in the agent's sandbox. */
    root?: string;
    /**
     * Only these tools (tools.json's names), none when empty: a run on another of your accounts
     * holds none of your tools (ADR 0045). Without it, every tool whose keys the run holds.
     */
    only?: string[];
  };
  /** A session the report named, to carry on in it rather than start again. */
  resume?: string;
  /** The commands it must never run (executors.json's `commands`), for its adapter to write as rules. */
  commands?: Commands;
  /** The gateway its model is served by, with its name in executors.json. */
  gateway?: Gateway & { id: string };
  /** A folder of its own for the run, kept until the run ends: its settings and sessions. */
  config?: string;
  /**
   * The result's JSON Schema (kernel/result.ts): an adapter whose agent can give its final answer
   * in it passes it on, and its reader hands that answer back (AgentReport.result), so the agent
   * needs no file outside its working folder.
   */
  resultSchema?: string;
  /**
   * Folders outside its working one the agent may use: read (your files, its copy of Shipify) and
   * write (the folder for files it makes for you). An adapter turns them into its agent's rules.
   */
  folders?: { read?: string[]; write?: string[] };
}

/** What a run did, as far as its agent says. Agents report what they can; every field is optional. */
export interface AgentReport {
  version?: string;
  /** The model that did the work, by its full id. */
  model?: string;
  /** Every model it called, by id. */
  models?: Record<string, Tokens>;
  /** All models together. */
  tokens?: Tokens;
  turns?: number;
  /** Each tool, and how many times it was called: built-in tools by name, tools.json's as tool.call. */
  tools?: Record<string, number>;
  /** Calls its permissions refused. */
  denied?: string[];
  /**
   * It read content from outside the run: a web page or a search, or a command that fetched one.
   * Each adapter knows its own agent's ways (tools.json's look calls, tool.call, count without
   * it). A run that did proposes notes and calls only for your `yes` (decide).
   */
  readOutside?: boolean;
  /** The agent's own estimate at API prices, and whether a subscription covers it instead. */
  cost?: { usd: number; plan: boolean };
  /**
   * A subscription's limits after the run: each window's share used (0 to 1), when it resets, and
   * whether this run was refused because it's used up.
   */
  limits?: { window: string; used: number; resets?: string; rejected?: boolean }[];
  /** Why the agent says it stopped, when it wasn't a normal finish. */
  error?: string;
  /** Anything else worth saying, such as a tool server that didn't start. */
  notes?: string[];
  /** The run's session, for an adapter that can carry on in it (AgentRun.resume). */
  session?: string;
  /** Its final answer in the result's schema (AgentRun.resultSchema), when it gave one. */
  result?: unknown;
  /**
   * Its last words, when it answered in words and not in the result's schema (as a smaller model
   * may): for a question, the box takes them as the reply. A change still needs the result.
   */
  said?: string;
}

/** Reads one run's output, line by line, as the agent writes it. */
export interface OutputReader {
  /** A line of output: what the run's live log shows for it (undefined: nothing). */
  line(text: string): string | undefined;
  /** Everything read, once the agent has stopped. */
  report(): AgentReport;
}

export interface Adapter {
  /** The agent's name for people: "Claude Code". */
  name: string;
  /** It takes tools (ADR 0015): MCP servers, and allow and deny lists (look calls only). */
  tools: boolean;
  /** The command for one run. It may write the agent's config files into run.tools.dir. */
  argv(run: AgentRun): string[];
  reader(): OutputReader;
  /**
   * How this agent names a tool's call, for the prompt: tools.json's
   * notion.search is Claude Code's mcp__notion__search. Without it, tool.call.
   */
  callName?(tool: string, call: string): string;
  /** A model's name for people ("Sonnet 5.5"), or undefined when the id isn't this agent's. */
  modelName?(id: string): string | undefined;
  /**
   * What this agent reads in the workspace root besides AGENTS.md (its own instructions file, its
   * skills folder), made once and never replaced. `platform` is the platform repo's folder name.
   */
  workspace?(root: string, platform: string, guide: string): void;
  /**
   * Variables this agent needs on every run (Claude Code: no update in the middle of a task), with
   * the run's folders as the agent sees them: its own (`config`) and its settings (`tools`).
   */
  env?(paths: { config: string; tools: string }): Record<string, string>;
}

/**
 * Whether a shell command reads from outside the run: a URL in it, or curl or wget as a command
 * (after a separator, a wrapper such as `timeout 10`, or a path). One that only looks like it asks
 * for your `yes` sooner, no more. Every adapter uses it for `AgentReport.readOutside`.
 */
const FETCHES =
  /:\/\/|(?:^|[;&|(`{\n]|\$\()\s*(?:(?:sudo|env|nohup|time|exec|command|if|then|do|else|!|timeout\s+\S+|\w+=\S*)\s+)*(?:\S*\/)?(?:curl|wget)(?:\s|$)/m;
export const fetchesOutside = (command: string) => FETCHES.test(command);
