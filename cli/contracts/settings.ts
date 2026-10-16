// Every setting a copy has, on one list (ADR 0047): a value (a variable on your copy) or a key (a
// secret: GitHub's, the edge Worker's, or this PC's credentials file), by name. The core's are
// here; the edge adds its own (edge/setup/settings.ts), and each plug-in its own from its file (a
// stack's deploy values and keys, a tool's keys, an agent's login, a gateway's key). `ship setup`,
// `ship doctor`, the guides' table (docs/settings.md) and the workflows' test all read the one list
// (cli/lib/settings.ts), so a setting can't be added in one place and forgotten in another.

/** Where a setting lives: a variable or a secret on your copy, the edge's Worker, or this PC. */
export type Home = "variable" | "secret" | "worker" | "pc";

export interface Setting {
  name: string;
  /** Where it lives: its home first, then where a copy is kept (this PC keeps your values). */
  lives: Home[];
  /** What it holds, in a few words. */
  what: string;
  /** What sets it: a command, or you. */
  setBy: string;
  /** The `ship setup` steps that set it, and check it's there. */
  steps?: string[];
  /** What reads it. */
  readBy: string;
  /** No task runs without it: one of the four core steps sets it. */
  core?: boolean;
  /** It may stay unset: then its default applies. */
  optional?: boolean;
}

/** The core's own settings: none names a host, a tool or a channel. */
export const CORE_SETTINGS: readonly Setting[] = [
  {
    name: "SHIPIFY_TIME_ZONE",
    lives: ["variable", "pc"],
    what: "your time zone, like Europe/London",
    setBy: "`ship setup`",
    steps: ["settings"],
    readBy: "runs (repeats' times, times in replies), and the edge, read live",
    core: true,
  },
  {
    name: "SHIPIFY_OWNER",
    lives: ["variable"],
    what: "your login: only your events start runs",
    setBy: "`box add`",
    steps: ["box"],
    readBy: "`task.yml`, `watch.yml`: nothing runs without it",
    core: true,
  },
  {
    name: "SHIPIFY_BOT_CLIENT_ID",
    lives: ["variable"],
    what: "the bot's client id",
    setBy: "`ship bot`",
    steps: ["bot"],
    readBy: "the mint steps of `task.yml` and `watch.yml`: the bot's one-hour tokens",
    core: true,
  },
  {
    name: "SHIPIFY_BOT_SLUG",
    lives: ["variable"],
    what: "the bot's name",
    setBy: "`ship bot`",
    steps: ["bot"],
    readBy: "`task.yml`, `watch.yml`: its commits' name, and its events start runs",
    core: true,
  },
  {
    name: "SHIPIFY_BOT_KEY",
    lives: ["secret"],
    what: "the bot's private key",
    setBy: "`ship bot`",
    steps: ["bot"],
    readBy: "the mint steps of `task.yml` and `watch.yml`, alone",
    core: true,
  },
  {
    name: "SHIPIFY_AGENT",
    lives: ["variable"],
    what: "which agent runs when nothing picks one, and the menus' default (unset: `executors.json`'s default)",
    setBy: "you",
    readBy: "`task.yml` (a run, and what it says in a chat), and the edge's menus",
    optional: true,
  },
  {
    name: "SHIPIFY_REPOS_CLIENT_ID",
    lives: ["variable"],
    what: "the repos App's client id, for your other accounts (ADR 0045)",
    setBy: "`ship bot repos`",
    steps: ["repos"],
    readBy: "the repos App's mint steps in `task.yml`",
  },
  {
    name: "SHIPIFY_REPOS_SLUG",
    lives: ["variable"],
    what: "the repos App's name",
    setBy: "`ship bot repos`",
    steps: ["repos"],
    readBy: "`task.yml`: its commits' name, and its install link in a reply",
  },
  {
    name: "SHIPIFY_REPOS_KEY",
    lives: ["secret"],
    what: "the repos App's private key",
    setBy: "`ship bot repos`",
    steps: ["repos"],
    readBy: "the repos App's mint steps in `task.yml`, alone",
  },
  {
    name: "SHIPIFY_ACCOUNTS",
    lives: ["variable"],
    what: "your other accounts, each `login:id` (GitHub's id pins it)",
    setBy: "`ship bot repos <account>`",
    readBy: "`task.yml`, every step: only these and your copy's are yours; any other is only read",
    optional: true,
  },
  {
    name: "SHIPIFY_PEOPLE",
    lives: ["variable"],
    what: 'your id on each channel, as JSON `[{"name":"…","on":{"<channel>":"<id>"}}]`',
    setBy: "`ship add <channel>`",
    readBy: "the edge and runs: chat messages come only from these ids, and go only to them",
  },
  {
    name: "SHIPIFY_SEND",
    lives: ["variable"],
    what: "your default channels, comma-separated (unset: GitHub only)",
    setBy: "`ship add <channel>`",
    readBy: "runs: alerts, repeats' replies and recipes' tasks",
    optional: true,
  },
  {
    name: "SHIPIFY_DIGEST",
    lives: ["variable"],
    what: "when the weekly digest comes to your default chats, as a repeat says it (`every monday at 9:00`, the default, in your time zone), or `off`",
    setBy: "you",
    readBy: "the due run (ADR 0053)",
    optional: true,
  },
  {
    name: "SHIPIFY_STAY",
    lives: ["variable"],
    what: "how many quiet minutes a run stays after answering your words, so your next words are answered in the same session (`10`, the default; `0`: never; at most `45`)",
    setBy: "you",
    readBy: "a task's run: its decide and stay steps (ADR 0057)",
    optional: true,
  },
  {
    name: "SHIPIFY_GATEWAYS",
    lives: ["variable"],
    what: 'each gateway with a key set, and since when: `{"<gateway>": "YYYY-MM-DD"}`',
    setBy: "`ship add <gateway>`, `ship remove <gateway>`",
    readBy: "the web chat's Setup",
    optional: true,
  },
  {
    name: "SHIPIFY_KEY_DATES",
    lives: ["variable"],
    what: 'when your keys expire: `{"<key>": "YYYY-MM-DD"}`',
    setBy: "`ship doctor --yes` (this PC's token, each agent's login), and you",
    readBy: "the watch, 30 and 7 days before each; the status page",
    optional: true,
  },
  {
    name: "SHIPIFY_TEMPLATE",
    lives: ["variable", "pc"],
    what: "the template this copy follows, `owner/name` (unset: the one its version file names, else the one GitHub says it was made from)",
    setBy: "`ship template` (where releases are made), or you",
    steps: ["updates"],
    readBy: "`update.yml` (`ship update`), and `ship template`",
    optional: true,
  },
  {
    name: "SHIPIFY_PRIVATE_WORDS",
    lives: ["variable"],
    what: 'words never published to the template, each with its stand-in: `{"<word>": "<stand-in>"}` (any case; ADR 0055)',
    setBy: "you",
    readBy: "`ship template`: replaced in what it publishes, then checked for",
    optional: true,
  },
  {
    name: "SHIPIFY_TEMPLATE_TOKEN",
    lives: ["secret", "pc"],
    what: "a read-only key for a private template on another account (Contents: read, that repo only)",
    setBy: "`ship setup updates` (`--new` for a new one)",
    steps: ["updates"],
    readBy: "`update.yml`, alone",
    optional: true,
  },
  {
    name: "SHIPIFY_CONSOLES",
    lives: ["variable"],
    what: "each box's Cockpit link, as JSON",
    setBy: "`box add --manage`",
    readBy: "`ship box list`",
    optional: true,
  },
];
