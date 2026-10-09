// Every kind of plug-in Shipify has (ADR 0027, docs/plug-ins.md): its contract, where its plug-ins
// live, how to add one, and the test every plug-in of that kind passes. The core works through these
// contracts and names no plug-in; `ship plugins` shows this list with what's there now.

export interface Kind {
  id: string;
  /** Its name for people. */
  name: string;
  /** What a plug-in of this kind agrees to. */
  contract: string;
  /** Where the contract is written down: a file, or the doc that holds it. */
  where: string;
  /** Where its plug-ins live. */
  lives: string;
  /** How to add one. */
  add: string;
  /** The test every plug-in of this kind passes. */
  test: string;
}

export const KINDS: Kind[] = [
  {
    id: "record",
    name: "record and queue",
    contract: "read and write a task, its comments, labels and state; start a run; list runs",
    where: "cli/lib/plugins/record.ts",
    lives: "cli/lib/github.ts (githubRecord, githubQueue)",
    add: "a file like github.ts with a TaskRecord and a Queue, chosen in task/context.ts",
    test: "tests/plugins/record.test.ts",
  },
  {
    id: "agent",
    name: "agent",
    contract: "a prompt, a model, an effort and look tools in; result.json, a report and usage out",
    where: "cli/lib/plugins/agent.ts",
    lives: "executors.json · cli/lib/agents/ (adapters, listed in agents/index.ts)",
    add: "an adapter in cli/lib/agents/ and its executors.json entry (plugins/_template/agent/)",
    test: "tests/plugins/agent.test.ts",
  },
  {
    id: "tool",
    name: "tool",
    contract: "an MCP server whose calls are each look or act, with a key per verb",
    where: "cli/lib/plugins/tool.ts",
    lives: "tools.json · tools/<name>/",
    add: "copy plugins/_template/tool/ to tools/<name>/ and add its tools.json entry",
    test: "tests/plugins/tool.test.ts",
  },
  {
    id: "channel",
    name: "chat channel",
    contract:
      "an adapter in the edge: prove a webhook, read it into one Message, send an Outgoing reply; a file and its health if it can",
    where: "edge/src/channels/channel.ts",
    lives:
      "edge/src/channels/<id>.ts (listed in channels/index.ts) · its tools.json entry (in.door, setup)",
    add: "an adapter, edge/src/channels/<id>.ts, one line in channels/index.ts, its fixtures in tests/edge/channels/, and pnpm ship add <id>",
    test: "tests/edge/channels.test.ts",
  },
  {
    id: "stack",
    name: "stack",
    contract: "the make targets, shipify.json, make deploy, /health with the deployed commit, docs",
    where: "docs/design.md (the contract)",
    lives: "stacks/<id>/ and its layers",
    add: "a folder in stacks/, from a second real project that wants the same setup",
    test: "tests/golden.test.ts",
  },
  {
    id: "check",
    name: "check",
    contract: "a script that takes no input and no keys, and prints one value to watch",
    where: "checks/README.md",
    lives: "checks/<name>.mjs",
    add: "copy checks/example.mjs to checks/<name>.mjs, in a PR you merge",
    test: "tests/checks.test.ts",
  },
  {
    id: "recipe",
    name: "recipe",
    contract:
      "a Markdown file: when (a schedule), an optional check and model, and the job as its body",
    where: "cli/lib/recipes.ts",
    lives: "recipes/<name>.md (examples in recipes/examples/)",
    add: "a file in recipes/, in a PR you merge (or say “turn on the <name> recipe”)",
    test: "tests/recipes.test.ts",
  },
  {
    id: "box",
    name: "box",
    contract: "takes runs by its labels, walls each slot's agent off, keeps nothing between runs",
    where: "docs/box-setup.md",
    lives: "box/setup.sh · the runners labelled shipify-box (and sandbox once checked)",
    add: "pnpm ship box add <user@host> --manage",
    test: "pnpm ship doctor on the box (its weekly clean-up runs it)",
  },
];
