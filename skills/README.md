# Skills

How to do the work well, for any agent. Each folder is a skill: a `SKILL.md` with a `name` and a
`description` that says when it applies, plus supporting files. Claude Code finds them through
`.claude/skills` (`ship sync` links it in the workspace); other agents read them from the table in
`AGENTS.md`. Where a skill and Shipify's own guides differ (plans, change docs, ADRs, commands,
the quality bar), **Shipify's guides win**.

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
- **Everything else:** unchanged.

**Adding or updating one:**
- **What qualifies:** a reputable source with a clear permissive license (MIT, Apache-2.0,
  CC-BY-4.0). No share-alike, source-available or unlicensed material.
- **Pin it:** record the commit in this table.
- **Keep it tool-neutral:** no required subagents, MCP servers or other agents' tools.
- **Size:** keep the set small. A skill earns its place when agents would otherwise get that
  kind of work wrong.
