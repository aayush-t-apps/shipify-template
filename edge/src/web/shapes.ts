// The web chat's answers (ADR 0036, "How the parts talk"): one shape per route, checked as it leaves
// the edge, so the page (edge/public/admin/chat/) reads one format. Every error is `{ error, fix }`:
// what happened and what to do, never a status code to show.
import { z } from "zod";
import { PICK } from "../../../cli/contracts/index.ts";
import { FILE_REF } from "../env.ts";
import { DOC_KINDS } from "./docs.ts";

const iso = z.string().max(40);
const url = z.string().max(2_000);

/**
 * A task's state, as one word the page shows as a mark. `waiting`: open, no run, and blocked by a
 * task still open (ADR 0066); not the `waiting` label, which is an errand's.
 */
export const STATES = ["needs-you", "working", "stuck", "waiting", "open", "closed"] as const;
/** Where a task started: "github", "repeat", "recipe", or the chat channel's id it came through. */
const origin = z.string().regex(/^[a-z][a-z0-9-]{0,30}$/);

export const Box = z.object({
  name: z.string(),
  online: z.boolean(),
  slots: z.number(),
  busy: z.number(),
});

export const Row = z.object({
  n: z.number(),
  title: z.string(),
  state: z.enum(STATES),
  from: origin,
  updated: iso,
  url,
  /** A run stays on it, for your next words (ADR 0057). */
  staying: z.literal(true).optional(),
  /** Its labels other than those the row already says (the list filters by them). */
  labels: z.array(z.string()).optional(),
  /** A split task's parts (ADR 0066): closed of all, from GitHub's own count. */
  parts: z.object({ done: z.number(), total: z.number() }).optional(),
  /** A part's parent, from its body's first line `Part of #<n>`. */
  parent: z.number().optional(),
});

/** A part of a split task, as its parent's Plan card shows it (ADR 0066). */
export const Part = z.object({
  n: z.number(),
  title: z.string(),
  state: z.enum(STATES),
  /** Closed as not planned: not done, so what waits for it waits. */
  dropped: z.literal(true).optional(),
  /** Open, never ran, every blocker closed as completed: `go` starts it. */
  ready: z.literal(true).optional(),
  /** What it waits for: its blockers not closed as completed. */
  after: z.array(z.number()).optional(),
  /** The open PR that closes it. */
  pr: z.object({ n: z.number(), url }).optional(),
});

export const Running = z.object({
  n: z.number(),
  title: z.string(),
  since: iso,
  /** The live log. */
  url,
  queued: z.boolean(),
});

/** A PR of shipify's waiting for review, and the task it's for. */
export const Review = z.object({
  n: z.number(),
  title: z.string(),
  updated: iso,
  url,
  task: z.number().optional(),
});

export const List = z.object({
  v: z.literal(1),
  version: z.string(),
  boxes: z.array(Box),
  running: z.array(Running),
  review: z.array(Review),
  tasks: z.array(Row),
  /** Open tasks (the default), or the closed ones (`?closed=1`), which carry only their tasks. */
  closed: z.boolean(),
  /** Which page of the list this is (`?page=`): older pages carry only their tasks. */
  page: z.number().int().min(1),
  /** Whether there's an older page. */
  more: z.boolean(),
  /** GitHub couldn't be read just now: this is the last good answer (the page retries). */
  stale: z.literal(true).optional(),
});

/** A file in a message: shown by the edge when it keeps it (`src`), else its name alone. */
export const FileSeen = z.object({
  name: z.string(),
  type: z.string().optional(),
  size: z.number().optional(),
  /** The edge's own address for it: one it keeps (7 days), or one a chat keeps (Telegram's). */
  src: z.string().optional(),
});

export const ReplySeen = z.object({
  kind: z.string(),
  state: z.string(),
  brief: z.string().optional(),
  /** The run in numbers (its reply line's `run`), for the task's totals. */
  run: z
    .object({
      secs: z.number(),
      tokens: z.number().optional(),
      usd: z.number().optional(),
      plan: z.boolean().optional(),
      model: z.string().optional(),
    })
    .optional(),
  question: z.string().optional(),
  /** Short answers to the question, shown as buttons. */
  choices: z.array(z.string()).optional(),
  links: z.array(z.tuple([z.string(), z.string()])),
  /** Its buttons, as every chat has them (contracts' replyButtons): each sends its words. */
  buttons: z.array(z.object({ label: z.string(), words: z.string() })),
});

export const Msg = z.object({
  /** The comment's id, or 0 for the task's own words. */
  id: z.number(),
  who: z.enum(["you", "shipify", "other"]),
  name: z.string(),
  at: iso,
  /** GitHub's rendering, cleaned (clean.ts). */
  html: z.string(),
  /** The words as written, hidden lines left out: for Copy and Download. */
  md: z.string(),
  /** Its run's details, folded on GitHub: shown under its run line. */
  details: z.string().optional(),
  reply: ReplySeen.optional(),
  files: z.array(FileSeen),
  /** A `use …` line it starts with. */
  use: z.string().optional(),
  /** Your words a run has read (its 👀 on them). */
  read: z.literal(true).optional(),
  url,
});

export const Thread = z.object({
  v: z.literal(1),
  task: z.object({
    n: z.number(),
    title: z.string(),
    state: z.enum(STATES),
    from: origin,
    open: z.boolean(),
    /** Closed, and your last words carry it on: the run they start opens it again. */
    wakes: z.literal(true).optional(),
    repeats: z.boolean(),
    /** A run stays on it, for your next words (ADR 0057). */
    staying: z.literal(true).optional(),
    url,
    /** What its runs think with: its status comment's choice, or a `use …` said since. None is Auto. */
    model: z.string().optional(),
    prs: z.array(z.object({ n: z.number(), url, state: z.string() })),
    /** A run going now: since when, and its log. */
    running: Running.optional(),
    /** A PR, read here to review: its state. */
    pr: z.enum(["open", "merged", "closed"]).optional(),
    /** The task a PR is for. */
    for: z.number().optional(),
    /** A part's parent (ADR 0066). */
    parent: z.number().optional(),
    /** A split task after your `go`: a part's merge starts the next. */
    started: z.literal(true).optional(),
    /** A split task's parts, in order: its Plan card. None when GitHub's read failed. */
    plan: z.array(Part).max(50).optional(),
  }),
  messages: z.array(Msg),
  /** Older messages left out: GitHub's pages of 100, and `page` is the one here (?page= reads one). */
  earlier: z.boolean(),
  page: z.number().int().min(1).optional(),
  /** Whether the task takes words from the chat (yours, not a PR, the status task, a page…). */
  writable: z.boolean(),
  /** GitHub couldn't be read just now: this is the last good answer (the page retries). */
  stale: z.literal(true).optional(),
});

export const Menu = z.object({
  v: z.literal(1),
  /** The agents a `use` line may name, each with its models and Auto; a chip when there's two. */
  agents: z.array(
    z.object({
      id: z.string(),
      /** Its name for people (executors.json's `name`: OpenCode), when it isn't its id's. */
      name: z.string().optional(),
      /** Its gateway (executors.json's `gateways`), when its models come through one. */
      gateway: z.string().optional(),
      /** The agent this is through another gateway (pi-vercel: pi): the picker shows it under its tab. */
      of: z.string().optional(),
      /** Its gateway's name for people ("Vercel"): the tab's word, and its gateway's in the row. */
      via: z.string().optional(),
      /** Its efforts: a model its gateway has that isn't listed takes them (the chip's search). */
      efforts: z.array(z.string()),
      models: z.array(
        z.object({ id: z.string(), efforts: z.array(z.string()), about: z.string().optional() }),
      ),
      auto: z.object({ model: z.string(), effort: z.string() }),
    }),
  ),
  /** The default agent's models and Auto. */
  models: z.array(
    z.object({ id: z.string(), efforts: z.array(z.string()), about: z.string().optional() }),
  ),
  auto: z.object({ model: z.string(), effort: z.string() }),
  /** What "Change a repo" offers, and the kinds a title names (ADR 0047): Shipify's own account's
   * repos, as the record keeps them. */
  repos: z.array(z.string()),
  /** Those of them Shipify built (a shipify.json): a project's page links its spec and decisions. */
  projects: z.array(z.string()),
  /** The apps the watch looks at, from the same record: a project's page says if it's up. */
  apps: z.array(z.object({ id: z.string(), url, failing: z.boolean(), paused: z.boolean() })),
  commands: z.array(z.tuple([z.string(), z.string()])),
  files: z.object({ on: z.boolean(), most: z.number(), bytes: z.number() }),
  /** Notifications (ADR 0050), when the edge has its key and a store: the key to subscribe with. */
  notifications: z.object({ key: z.string() }).optional(),
  /** The most characters a message may have (SendBody's words). */
  chars: z.number(),
  /** The Repeat form's choices, as `4-repeat.yml` has them (forms.ts). */
  repeat: z.object({
    kinds: z.array(z.string()),
    /** The Model choices: the words sent, and how each reads ("pi-vercel", "Pi · Vercel"). */
    models: z.array(z.object({ words: z.string(), label: z.string() })),
    when: z.string(),
    /** The owner's time zone, as a repeat's times are said: "IST". */
    zone: z.string(),
  }),
  version: z.string(),
});

/** A search of an agent's gateway for models (`…/api/models?agent=&q=`), each as `use` takes it. */
/** Models an agent's gateway has (`…/api/models`), each with what the gateway says of it. */
export const Models = z.object({
  v: z.literal(1),
  models: z.array(
    z.object({
      id: z.string(),
      name: z.string().optional(),
      maker: z.string().optional(),
      price: z.tuple([z.number(), z.number()]).optional(),
      context: z.number().optional(),
      output: z.number().optional(),
      can: z.array(z.enum(["tools", "reasoning", "images"])).optional(),
      efforts: z.array(z.string()).optional(),
    }),
  ),
});

export const Repeats = z.object({
  v: z.literal(1),
  repeats: z.array(
    z.object({
      n: z.number(),
      title: z.string(),
      open: z.boolean(),
      every: z.string().optional(),
      next: iso.optional(),
      url,
    }),
  ),
  /** Errands (ADR 0054): tasks labelled `waiting`, each with what it waits for and its next look. */
  waiting: z
    .array(
      z.object({
        n: z.number(),
        title: z.string(),
        every: z.string().optional(),
        next: iso.optional(),
        url,
      }),
    )
    .optional(),
  recipes: z.array(
    z.object({
      name: z.string(),
      task: z.number().optional(),
      every: z.string().optional(),
      next: iso.optional(),
      paused: z.boolean(),
      url,
    }),
  ),
});

export const Notebook = z.object({
  v: z.literal(1),
  pages: z.array(z.object({ topic: z.string(), first: z.string(), lines: z.number(), url })),
});

export const Files = z.object({
  v: z.literal(1),
  files: z.array(
    z.object({
      ref: z.string(),
      name: z.string(),
      type: z.string(),
      size: z.number(),
      task: z.number().optional(),
      by: z.enum(["you", "run"]),
      at: iso,
      /** When it goes. */
      until: iso.optional(),
      src: z.string(),
    }),
  ),
});

/**
 * A kept file, for the doc pane (`…/api/doc/<ref>`, ADR 0065): what it is, and its words to show.
 * Markdown comes as GitHub's rendering, cleaned; a CSV as rows; other text as text; a PDF or a
 * picture shows from the file itself. `cut`: only its start is here (Download has it all).
 */
export const Doc = z.object({
  v: z.literal(1),
  ref: z.string(),
  name: z.string(),
  type: z.string(),
  size: z.number(),
  kind: z.enum(DOC_KINDS),
  html: z.string().optional(),
  text: z.string().optional(),
  rows: z.array(z.array(z.string())).optional(),
  cut: z.literal(true).optional(),
});

/**
 * A device kept for notifications, for people: a short id (its address's SHA-256, 8 hex
 * characters), its push service ("Google"), and since when.
 */
const DeviceSeen = z.object({ id: z.string(), service: z.string(), since: iso });

export const Setup = z.object({
  v: z.literal(1),
  door: z.object({
    closed: z.boolean(),
    version: z.string(),
    commit: z.string(),
    repo: z.string(),
  }),
  boxes: z.array(
    Box.extend({
      tasks: z.array(z.number()),
      /** What its health says needs a look ("disk: 91% full"), from the status task's record. */
      look: z.array(z.string()),
      /** When its health was last read. */
      at: iso.optional(),
      /** Its web console (Cockpit), reachable from your own devices only. */
      console: url.optional(),
    }),
  ),
  /** The watch: when it last looked, when the next repeat is due, and the newest events. */
  watch: z.object({
    last: iso.optional(),
    next: iso.optional(),
    events: z.array(z.object({ at: iso, text: z.string() })),
  }),
  chats: z.array(
    z.object({ id: z.string(), name: z.string(), ready: z.boolean(), people: z.number() }),
  ),
  agents: Menu.shape.agents,
  models: Menu.shape.models,
  /** Each gateway, and since when its key is set (`ship add <gateway>`); none: not set up. */
  gateways: z.array(z.object({ id: z.string(), about: z.string(), since: z.string().optional() })),
  auto: Menu.shape.auto,
  apps: z.array(z.object({ id: z.string(), url, failing: z.boolean(), paused: z.boolean() })),
  tools: z.array(
    z.object({
      id: z.string(),
      about: z.string(),
      look: z.array(z.string()),
      act: z.array(z.string()),
      pre: z.array(z.string()),
    }),
  ),
  keyDates: z.array(z.object({ name: z.string(), date: z.string() })),
  links: z.object({ variables: url, actions: url, issues: url }),
  /** The devices the web chat notifies (ADR 0050), when it has the key. */
  devices: z.array(DeviceSeen).optional(),
});

/** The devices kept, after notifications are turned on or off (`…/api/push`). */
export const Devices = z.object({ v: z.literal(1), devices: z.array(DeviceSeen) });

export const Sent = z.object({
  v: z.literal(1),
  /** The door's words: "Got it · #190", or /ping's answer. */
  text: z.string(),
  /** The task your words were written onto; none for an answer at once. */
  task: z.number().optional(),
});

export const Uploaded = z.object({
  v: z.literal(1),
  ref: z.string(),
  name: z.string(),
  type: z.string(),
  size: z.number(),
});

export const Problem = z.object({ error: z.string(), fix: z.string() });

export type List = z.infer<typeof List>;
export type Row = z.infer<typeof Row>;
export type Part = z.infer<typeof Part>;
export type Running = z.infer<typeof Running>;
export type Thread = z.infer<typeof Thread>;
export type Msg = z.infer<typeof Msg>;
export type FileSeen = z.infer<typeof FileSeen>;
export type Menu = z.infer<typeof Menu>;
export type Repeats = z.infer<typeof Repeats>;
export type Notebook = z.infer<typeof Notebook>;
export type Files = z.infer<typeof Files>;
export type Doc = z.infer<typeof Doc>;
export type Setup = z.infer<typeof Setup>;
export type Devices = z.infer<typeof Devices>;
export type Sent = z.infer<typeof Sent>;
export type Uploaded = z.infer<typeof Uploaded>;
export type State = (typeof STATES)[number];
export type Origin = string;

/** The most characters a message from the page may have: well inside GitHub's 65,536 a comment. */
export const MOST_CHARS = 16_000;

/** A send: what the page posts to `…/api/send`. */
/**
 * Notifications on this device, or off (`…/api/push`): the browser's subscription to keep, or the
 * address of one to drop (push.ts checks each).
 */
export const PushBody = z.union([
  z.object({ on: z.unknown() }).strict(),
  z.object({ off: z.string().max(2_000) }).strict(),
]);

export const SendBody = z.object({
  /** Made once by the page for this message: a retry or a second tab is written once. */
  id: z.string().regex(/^[\w-]{8,64}$/),
  task: z.number().int().positive().optional(),
  words: z.string().max(MOST_CHARS),
  /** A pick, as a `use` line says it (contracts' PICK). */
  use: z.string().max(140).regex(PICK).optional(),
  files: z
    .array(
      z.object({
        // Yours, or a run's (the doc pane's Ask about this): any the store keeps.
        ref: z.string().regex(FILE_REF),
        name: z.string().min(1).max(200),
        type: z.string().max(120),
        size: z.number().int().nonnegative(),
      }),
    )
    .max(5)
    .default([]),
});
export type SendBody = z.infer<typeof SendBody>;
