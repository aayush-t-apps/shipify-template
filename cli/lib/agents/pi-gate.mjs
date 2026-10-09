// Shipify's gate for pi (ADR 0038, "One setup"; ADR 0043): pi has no rules of its own, by design,
// so this extension holds it to the rules every agent gets. pi's adapter (pi.ts) writes the run's
// rules beside it (gate.json) and loads it with `-e`; each tool call is checked before it runs, and
// one that isn't allowed is refused with the reason, which the run's details list:
// - a command: runs, unless a part of it (split at ; && || | & and new lines, and inside $(…) and
//   `…`) starts with a refused one (`git push`, also after git's options). The walls are outside
//   the agent (its own Linux user, read-only keys), so there's no list of what it may run;
// - a file: read anywhere but this gate's own folder (its settings); written inside its working
//   folder or the folders it may write;
// - a tool: pi's own file and shell tools as above, and the look calls it was given; anything else
//   (an act call, a tool Shipify doesn't know) is refused, the safe default with no one watching;
// - in the read profile (`run: false`, ADR 0044): no command and no tool's call, files read only
//   inside its working folder and its read folders (links resolved first), and nothing written.
//   A tool it didn't get (left out by its adapter, or its server not connected) is named at the
//   end, never silently.
// Plain JavaScript, so pi loads it as it is, and any agent with no rules of its own can load it
// too. tests/agent-pi.test.ts and tests/plugins/agent.test.ts hold it to the rules every agent
// gets.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** How a refusal starts, for the reader to count it as one (pi.ts). */
export const REFUSED = "Refused by Shipify's rules";

/** Where `p` really is: its links resolved, from the nearest part of it that exists. */
const real = (p) => {
  let at = p;
  const rest = [];
  while (!existsSync(at) && dirname(at) !== at) {
    rest.unshift(basename(at));
    at = dirname(at);
  }
  return join(realpathSync(at), ...rest);
};

/** Whether `p` is `dir` or inside it. */
const inside = (p, dir) => {
  const r = relative(dir, p);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};

/** A command's parts, split where the shell runs one after another, quotes kept whole. */
export function parts(command) {
  const out = [];
  let cur = "";
  let quote = "";
  const push = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = "";
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const next = command[i + 1];
    if (c === "\\" && quote !== "'") {
      cur += c + (next ?? "");
      i++;
    } else if (quote) {
      if (c === quote) quote = "";
      else if (quote === '"' && c === "$" && next === "(") {
        const end = closing(command, i + 1);
        out.push(...parts(command.slice(i + 2, end)));
        cur += command.slice(i, end + 1);
        i = end;
        continue;
      } else if (quote === '"' && c === "`") {
        const end = command.indexOf("`", i + 1);
        out.push(...parts(command.slice(i + 1, end < 0 ? command.length : end)));
        cur += command.slice(i, end < 0 ? command.length : end + 1);
        i = end < 0 ? command.length : end;
        continue;
      }
      cur += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      cur += c;
    } else if (c === "$" && next === "(") {
      const end = closing(command, i + 1);
      out.push(...parts(command.slice(i + 2, end)));
      cur += command.slice(i, end + 1);
      i = end;
    } else if (c === "`") {
      const end = command.indexOf("`", i + 1);
      out.push(...parts(command.slice(i + 1, end < 0 ? command.length : end)));
      i = end < 0 ? command.length : end;
    } else if (c === ";" || c === "\n" || c === "|" || c === "&") {
      push();
      if ((c === "|" || c === "&") && next === c) i++;
    } else if (c === "(" || c === ")" || ((c === "{" || c === "}") && word(command, i))) {
      // A subshell's brackets, or a group's braces (words of their own, unlike `${HOME}` or
      // `-I{}`): what's inside is a command of its own.
      push();
    } else cur += c;
  }
  push();
  return out;
}

/** Whether the brace at `i` is a word of its own (a group's `{ … }`), not part of one (`${HOME}`). */
const word = (s, i) => {
  const edge = (c) => c === undefined || /[\s;&|()]/.test(c);
  return edge(s[i - 1]) && edge(s[i + 1]);
};

/** Where `$(` at `open` closes, counting nested ones; the end when it doesn't. */
function closing(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return i;
  }
  return s.length;
}

const starts = (part, prefix) =>
  part === prefix || part.startsWith(`${prefix} `) || part.startsWith(`${prefix}\t`);

/** Words before a command that still run it: a loop's or a branch's body, a wrapper. */
const BEFORE = new Set(
  "do then else ! time nice nohup command builtin exec env timeout xargs sudo stdbuf".split(" "),
);

/** A wrapper's option or its value, before the command it runs: `-n 5`, `-s KILL 9`, `-u HOME`. */
const OPTION = /^(?:-.*|\d[\d.]*[smhd]?|[A-Z][A-Z0-9_]*)$/;

/** git's own options that take the next word as their value (`git -C dir push`). */
const GIT_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env"]);

/** git's verb in `git [options] <verb> …`: the first word that isn't one of git's own options. */
function gitVerb(words) {
  for (let i = 1; i < words.length; i++) {
    const w = words[i] ?? "";
    if (!w.startsWith("-")) return w;
    if (GIT_VALUE.has(w)) i++;
  }
  return undefined;
}

/** Why a command is refused, or undefined when no part of it is. */
export function refusedCommand(rules, command) {
  for (const part of parts(command)) {
    // Quotes and escapes don't hide a word from the refused list: git -C . "push" is git push.
    const words = part.split(/\s+/).map((w) => w.replace(/["'\\]/g, ""));
    // What runs after a loop's `do`, a wrapper and its options (`timeout -s KILL 9`, `xargs -n1`)
    // or a variable (`A=1 git push`), as Claude Code reads them too.
    for (;;) {
      const w = words[0] ?? "";
      if (BEFORE.has(w)) {
        words.shift();
        while (words.length && OPTION.test(words[0] ?? "")) words.shift();
      } else if (/^\w+=/.test(w)) words.shift();
      else break;
    }
    // git by its path is git: /usr/bin/git push.
    if (words[0]?.endsWith("/git")) words[0] = "git";
    const said = words.join(" ");
    for (const d of rules.deny) {
      const git = /^git (\S+)$/.exec(d)?.[1];
      if (git ? words[0] === "git" && gitVerb(words) === git : starts(said, d))
        return `\`${d}\` isn't for an agent (the box does it)`;
    }
  }
  return undefined;
}

/** Why a tool call isn't allowed, or undefined when it is. */
export function refused(rules, tool, input, cwd, own) {
  if (rules.run === false) {
    if (tool === "bash") return "this run only reads its files: no command";
    if (!READS.includes(tool)) return `${tool} isn't for a run that only reads its files`;
    const at = real(resolve(cwd, String(input.path ?? input.file_path ?? ".")));
    if (own && inside(at, real(own))) return "its settings aren't for it to read or change";
    if (![cwd, ...(rules.read ?? [])].some((d) => inside(at, real(d))))
      return `${at} is outside the folders it may read`;
    return undefined;
  }
  if (tool.startsWith("mcp__"))
    return rules.look.includes(tool) ? undefined : `${tool} isn't one of the look calls it has`;
  if (tool === "bash") return refusedCommand(rules, String(input.command ?? ""));
  if (!FILES.includes(tool)) return `${tool} isn't a tool Shipify knows`;
  const at = resolve(cwd, String(input.path ?? input.file_path ?? "."));
  if (own && inside(at, own)) return "its settings aren't for it to read or change";
  const writes = tool === "write" || tool === "edit";
  if (writes && ![cwd, ...rules.write].some((d) => inside(at, d)))
    return `${at} is outside the folders it may write`;
  return undefined;
}

/** pi's own tools on files: the ones that read, and write and edit. */
const READS = ["read", "ls", "grep", "find"];
const FILES = [...READS, "write", "edit"];

export default function gate(pi) {
  const own = dirname(fileURLToPath(import.meta.url));
  const rules = JSON.parse(readFileSync(join(own, "gate.json"), "utf8"));
  pi.on("tool_call", async (event) => {
    const why = refused(rules, event.toolName, event.input ?? {}, process.cwd(), own);
    return why ? { block: true, reason: `${REFUSED}: ${why}` } : undefined;
  });
  // The tools it didn't get, named once at the end in pi's output (an entry, which pi.ts's reader
  // puts in the run's details): those its adapter left out (`left`, with why), and each look call
  // pi never got, its server not connected, which pi says only on its own screen.
  let told = false;
  pi.on("agent_end", () => {
    if (told) return;
    told = true;
    const have = new Set(pi.getAllTools().map((t) => t.name));
    const missing = rules.look.filter((c) => !have.has(c));
    const left = rules.left ?? [];
    if (missing.length || left.length) pi.appendEntry("shipify-gate", { left, missing });
  });
}
