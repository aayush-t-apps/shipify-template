// One way to run git (ADR 0044): every clone's arguments and every git process's environment, for
// think (as the agent's own user), apply and the GitHub jobs. A key goes in the environment
// (GIT_CONFIG_*, which git reads after its files), never on a command line, where `ps` shows it to
// the box's other users; the safe settings go with it. Pure, so the shapes are tested alone.

/** What every git process here runs with: no repo's hooks, no fsmonitor, no file:// transport. */
export const SAFE: [string, string][] = [
  ["core.hooksPath", "/dev/null"],
  ["core.fsmonitor", ""],
  ["protocol.file.allow", "never"],
];

/** git settings for one process's environment, as GIT_CONFIG_COUNT and its KEY_n/VALUE_n pairs. */
export function gitConfig(pairs: [string, string][]): Record<string, string> {
  const out: Record<string, string> = { GIT_CONFIG_COUNT: String(pairs.length) };
  pairs.forEach(([k, v], i) => {
    out[`GIT_CONFIG_KEY_${i}`] = k;
    out[`GIT_CONFIG_VALUE_${i}`] = v;
  });
  return out;
}

/** A GitHub token as git's header for github.com: what lets git read (or push) with it. */
export function keyFor(token: string): [string, string] {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return ["http.https://github.com/.extraheader", `AUTHORIZATION: basic ${basic}`];
}

/**
 * An environment for git built from nothing (apply, the GitHub jobs): PATH and HOME, no prompt for
 * a password, the safe settings, then any more (the bot's name), and the key when there's one. A
 * clone of a repo outside your account gets no key at all, so none can reach it.
 */
export function gitEnv(token?: string, more: [string, string][] = []): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    GIT_TERMINAL_PROMPT: "0",
    ...gitConfig([...SAFE, ...more, ...(token ? [keyFor(token)] : [])]),
  };
}

/**
 * A clone's shape, from what the run does with it (ADR 0044): never a setting.
 * - `read`: depth 1, one branch, no tags, no checkout yet (its files' size is checked first);
 *   outside your account, links are checked out as plain files (`core.symlinks=false`, kept in
 *   the clone's own config, so the checkout after it keeps it too);
 * - `change`: its whole history, as a change run's clone always was;
 * - `apply`: history without file contents, no checkout, the repo's default branch only (`main`
 *   unless said, ADR 0045; an empty repo has none).
 */
export type Shape = "read" | "change" | "apply";

export function cloneArgs(
  shape: Shape,
  url: string,
  dir: string,
  opts: { outside?: boolean; empty?: boolean; branch?: string } = {},
): string[] {
  const base = ["git", "clone", "--quiet"];
  if (shape === "change") return [...base, url, dir];
  if (shape === "apply")
    return [
      ...base,
      "--filter=blob:none",
      "--no-checkout",
      "--no-tags",
      "--single-branch",
      ...(opts.empty ? [] : ["--branch", opts.branch ?? "main"]),
      url,
      dir,
    ];
  return [
    ...base,
    "--depth",
    "1",
    "--no-tags",
    "--single-branch",
    "--no-checkout",
    ...(opts.outside ? ["--config", "core.symlinks=false"] : []),
    url,
    dir,
  ];
}

/** The URL git clones a GitHub repo from. */
export const githubUrl = (repo: string) => `https://github.com/${repo}.git`;

/** Doctor's floor (`ship doctor`): the free disk a box keeps, which no clone may take it below. */
export const DISK_FLOOR_BYTES = 5 * 1024 ** 3;

/** Whether `bytes` more fit on a disk with `free` bytes, leaving the floor free. */
export const fits = (bytes: number, free: number) => free - bytes >= DISK_FLOOR_BYTES;

/** A size for a line the owner reads: "1.8 GB", "640 MB". */
export function sizeSaid(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}
