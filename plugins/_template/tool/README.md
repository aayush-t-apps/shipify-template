# A new tool: the checklist

A tool is an MCP server with two kinds of call: **look** (reads: the agent makes them on any run)
and **act** (changes: the agent proposes them, and the box makes them after your `yes`). Its
contract: [cli/lib/plugins/tool.ts](../../../cli/lib/plugins/tool.ts). The whole story:
[docs/tools.md](../../../docs/tools.md).

1. **Copy this folder** to `tools/<name>/` (lowercase, like `linear`) and rename what says
   `example`.
2. **Write its calls** in `server.ts`: one per thing a task may do, each with a plain description
   and a JSON schema for its input. Keep each answer short text.
3. **Sort every call** into look or act in its `tools.json` entry (`entry.json` here is the shape).
   A call that changes anything is act. Give each act call its argument check under `args`
   (`required`, `properties`; `files` for an argument that names files the task shared, which the
   server then reads from `SHIPIFY_FILES`), and add `pre` forms only for calls safe to make with
   no `yes`.
4. **Two keys when the service allows it:** a read-only key for look, a write key for act, each
   named by its verb in the entry's `keys`. A service with one key for everything: set
   `"oneKey": true`.
5. **Its keys in `task.yml`:** the look secret in the think step's env; the act secret in the apply
   step's env, gated on `steps.decide.outputs.act == '<name>'`, as Notion's are. A test holds
   `task.yml` to `tools.json`.
6. **Its `setup`** in the entry: what you need first, in plain words (where to make each key, with
   which permissions), and what to ask for each key. Nobody sets a key by hand:
   `pnpm ship add <name>` takes each at a hidden prompt, sets it on shipify and checks it, and
   `pnpm ship remove <name>` undoes it.
7. **A `--check`** that calls the service once with the key and prints one line: `ship doctor`,
   `ship add` and `ship selftest <name>` run it.
8. **A skill:** `skills/<name>/SKILL.md` from `SKILL.md` here: its calls, and how to use them well.
9. **A fake service** for tests (`tests/fixtures/fake-notion.mjs` is one), and tests of what's
   yours: the conformance test (`tests/plugins/tool.test.ts`) already checks the entry and that
   the server offers exactly its calls.
10. **Docs:** a section in `docs/tools.md`, and a row in `skills/README.md`.
11. **Check:** `pnpm ship tools check`, `pnpm verify`, then after the merge `pnpm ship add <name>`,
    `pnpm ship selftest <name>` and a task that uses it.
