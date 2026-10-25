# Skills

How to do the work well, for any agent. Each folder is a skill: a `SKILL.md` with a `name` and a
`description` that says when it applies, plus supporting files. Where a skill and Shipify's own
guides differ (plans, change docs, ADRs, commands, the quality bar), **Shipify's guides win**.

**How agents find them** (ADR 0038):
- **On a task,** every run hands its agent this folder, from its read-only copy of Shipify. The
  agent lists each skill with its description, and loads one when it fits: pi takes the folder
  (`--skill`), OpenCode its config's `skills.paths`, and Claude Code finds it linked in its
  settings folder. A read run gets none.
- **On this PC,** Claude Code finds them through `.claude/skills` (`ship sync` links it in the
  workspace); other agents read them from the table in `AGENTS.md`.

**Make, prove, see:**
- **Make:** [writing-skills](writing-skills/SKILL.md) is how: no skill, and no line in one,
  without a failure seen without it.
- **Prove:** each of Shipify's own skills has a `scenarios.md` beside it: asks that should load
  it, near misses that shouldn't, and cases (the ask, what went wrong without it, what it does
  instead). A vendored skill gets one when it's changed here.
- **See:** each run's details list the skills its agent loaded (**Skills**), and the weekly digest
  counts them and names the ones no run loaded. One that stays unloaded needs a sharper
  description, or removing. Nothing changes by itself.

**The skill check** (`tests/skills.test.ts`, in `pnpm verify`): each header is plain YAML (an
unquoted line with a colon in it isn't, and pi skips that skill), its `name` is its folder's, its
`description` says when to use it in 300 characters at most, with no task numbers or dates, its
`SKILL.md` is 500 lines at most, it has a row here and in `AGENTS.md`, and each of Shipify's own
has its `scenarios.md`.

**Lessons:** when you correct an agent, or it finds the way after dead ends, its reply names the
skill and the lesson in one line ("Lesson for `<skill>`: …"). The weekly lessons recipe
(`recipes/weekly-lessons.md`) gathers them every Monday and asks for one PR that keeps them; with
it off, the line also gives the words to keep it (`shipify: add to the <skill> skill: …`). That PR
changes the skill and adds the lesson as a case in its `scenarios.md`, and you merge it: a lesson
is never written by an agent alone, so a page it read can't plant one that every later run
follows.

| Skill | Use it when | From | License |
|---|---|---|---|
| [frontend-design](frontend-design/SKILL.md) | building or reshaping any UI | [anthropics/skills](https://github.com/anthropics/skills/tree/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design) | Apache-2.0 |
| [test-driven-development](test-driven-development/SKILL.md) | any feature or fix, before the code | [obra/superpowers](https://github.com/obra/superpowers/tree/5bf4e78011075bcfc0dc295f0724994cd123ee71/skills/test-driven-development) | MIT |
| [systematic-debugging](systematic-debugging/SKILL.md) | a bug, a failing test or CI run, before any fix | [obra/superpowers](https://github.com/obra/superpowers/tree/5bf4e78011075bcfc0dc295f0724994cd123ee71/skills/systematic-debugging) | MIT |
| [verification-before-completion](verification-before-completion/SKILL.md) | before saying anything is done or passing | [obra/superpowers](https://github.com/obra/superpowers/tree/3be5aad3dd2400ef23b15680969f4bcd3b6d7b8b/skills/verification-before-completion) | MIT |
| [codebase-design](codebase-design/SKILL.md) | shaping modules and interfaces, in code, plans or change docs | [mattpocock/skills](https://github.com/mattpocock/skills/tree/d80fa0f4ebe0c5714af0adf8670336065233ecc6/skills/engineering/codebase-design) | MIT |
| [api-and-interface-design](api-and-interface-design/SKILL.md) | an HTTP API, a package's exports, types between modules | [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills/tree/ce89b03cbd768d4c9f512beedae46c20822a6bf6/skills/api-and-interface-design) | MIT |
| [security-and-hardening](security-and-hardening/SKILL.md) | user input, sessions, secrets, third parties, dependencies | [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills/tree/d1463fd0d6675c6e145d9c57802d70faf84d1f51/skills/security-and-hardening) | MIT |
| [notion](notion/SKILL.md) | a task reads or changes the owner's Notion (Shipify's Notion tool, `tools/notion`) | this repo | this repo's |
| [plug-ins](plug-ins/SKILL.md) | adding or changing any plug-in: a tool, a chat channel, a stack, an agent | this repo | this repo's |
| [writing-skills](writing-skills/SKILL.md) | adding a skill, putting a lesson into one, or changing one | this repo (its method after [obra/superpowers](https://github.com/obra/superpowers/tree/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/writing-skills)) | this repo's |

Each folder keeps its license file (`LICENSE`, or `LICENSE.txt` for Apache-2.0); the copyright
belongs to the authors named there.

**Changes from the originals** (vendored on 2026-09-29):
- **All skills:** authoring leftovers were left out: test-pressure transcripts, creation logs, and
  an agent-specific `agents/openai.yaml`.
- **`systematic-debugging` and `test-driven-development`:** references to another plugin's skill
  names now point at the skills here.
- **`security-and-hardening`:** two names of skills that aren't vendored here were taken out: the
  privacy section's telemetry note no longer names one, and a privacy incident's root cause points
  at `systematic-debugging` (2026-10-01).
- **For unattended runs** (ADR 0043, 2026-10-09):
  - `test-driven-development` and `systematic-debugging` start with an "In Shipify" note: the suite
    is `make test` in a project and `make verify` in shipify, one file `pnpm exec vitest run
    <file>`; "ask your human partner" means `needs-you` with one question when it changes what
    gets built, and `failed` after the same failure three times. Their `npm test` examples (and
    `find-polluter.sh`, `root-cause-tracing.md`) say those commands. `writing-good-tests.md`'s
    quoted corrections stay as examples.
  - `frontend-design`: "confirm with the client" is, in a task, a proposal in `DESIGN.md`, said in
    the reply, and the work carries on.
  - `codebase-design`: `DESIGN-IT-TWICE.md`'s helpers are optional (the designs can be written one
    after another), and its `GLOSSARY.md` is the project's glossary (`docs/glossary.md`).
  - `api-and-interface-design` no longer names `deprecation-and-migration`, and
    `security-and-hardening` no longer points at `references/security-checklist.md`: neither is
    vendored here.
- **`security-and-hardening`'s description** is one "Use when …" line of 196 characters, not its
  578 (2026-10-15): every run that gets skills reads it.
- **`test-driven-development`:** its "In Shipify" note adds that a test makes what it reads, never
  the owner's own files, which a release's check doesn't have; and it has a `scenarios.md`
  (2026-10-24).
- **Everything else:** unchanged.

**Adding or updating one** ([writing-skills](writing-skills/SKILL.md) has the whole way):
- **What qualifies:** a reputable source with a clear permissive license (MIT, Apache-2.0,
  CC-BY-4.0). No share-alike, source-available or unlicensed material.
- **Pin it:** record the commit in this table.
- **Keep it tool-neutral:** no required subagents, MCP servers or other agents' tools.
- **Size:** keep the set small. A skill earns its place when agents would otherwise get that
  kind of work wrong.
