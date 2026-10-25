---
name: writing-skills
description: Making or changing a skill in Shipify's skills/ well, from a failure seen to a tested PR. Use when adding a skill, putting a lesson into one, or changing a skill's wording, description or scenarios.
---

# Writing skills

A skill is how to do a kind of work well, and every agent reads it on every run it fits (ADR
0038). A good one changes what an agent does; a weak one costs every run its words and changes
nothing. So the method is test-driven, after obra/superpowers' writing-skills: **no skill, and no
line in one, without a failure you've seen without it.**

## First: is it a skill?

| It's | It goes in |
|---|---|
| a fact or a preference ("dark mode in every app") | a note in the notebook |
| the steps for one job in Shipify | a playbook (`playbooks/`) |
| one project's own rule | that repo's `AGENTS.md` |
| how to do a kind of work well, in any repo | a skill |

Patch the skill that fits before you make one. A new skill only when none fits, and only for work
agents would otherwise get wrong.

## The loop

1. **Red: see it fail.** Write the case first, in the skill's `scenarios.md`: the ask, and what
   went wrong without the skill. The best evidence is real: the run the owner corrected (a lesson),
   or a baseline, the same ask given to a fresh agent with no skill (a helper agent of your own,
   when you have one). "Without it" says only what was seen; never invent a failure. (A skill
   older than this method may name the risk it guards, marked "not yet seen", until a run shows
   one.)
2. **Green: the smallest change that fixes it.** Write what answers the failures: the rule, why it
   matters, what to do instead. Leave out what agents already do well.
3. **Refactor: close the gaps.** Try the case again with the skill, or reread the skill cold, as an
   agent meeting the ask would. Where an agent could talk its way around a rule, name that way
   ("even when the tests already pass").
4. **Keep the case.** It stays in `scenarios.md`, so the next change is checked against it.

## The description

It's all an agent sees until it loads the skill, so it says **when**, in the words asks use:
- what it's for, then "Use when …": the situations, the symptoms, the words people type;
- never a summary of the steps: an agent follows the summary and skips the skill;
- 300 characters at most, no task numbers or dates, plain YAML (quote it if it holds `: `).

Read it against `scenarios.md`: each ask under **Loads it** should match it, and none under **Not
this one** should.

## The body

- **Short:** under 500 lines, the main path first. What's needed only sometimes goes in a file
  beside it, named from the body ("see `deep.md` when …").
- **Rules with their reason,** so the agent can apply them to the case nobody wrote down.
- **One good example** beats three; a command beats a paragraph.
- **Tool-neutral:** any agent reads it. No other agent's tools, required helpers or MCP servers.
- **A lesson, not a log:** no task numbers, dates, box names or "tool X is broken".
- **Shipify's guides win** where a skill differs: plans, ADRs, commands, the quality bar.

## scenarios.md

Every skill of Shipify's own has one beside its `SKILL.md` (a vendored skill gets one when it's
changed here). The skill check reads its three sections:

```markdown
# Scenarios: <name>

## Loads it
- "an ask, in the owner's words, this skill is for"

## Not this one
- "a near miss: an ask that sounds close but isn't"

## Cases

### 1. <what goes wrong>
- **Ask:** what the owner asked.
- **Without it:** what an agent did without the skill, as seen.
- **Done well:** what the skill makes it do instead.
```

Three to five asks a list and a few cases are enough; each lesson adds a case.

## The PR

- **Shipify's own skill:** its `SKILL.md` and `scenarios.md`. A new one adds its row to
  `skills/README.md`'s table and `AGENTS.md`'s Skills table.
- **A vendored skill** (someone else's): a reputable source and a permissive license (MIT,
  Apache-2.0, CC-BY-4.0) kept in its folder, pinned to a commit in the README's table, and each
  change from the original listed there.
- **A CHANGELOG line** under Unreleased, then the skill check (`pnpm exec vitest run
  tests/skills.test.ts`; in a task, the box's `make verify` runs it again): it reads the header,
  the sizes, both tables and the scenarios.
- **Say what it fixes:** the failure, and what the case did with the skill.
- **The owner's merge approves it.** A skill is never changed by an agent alone, so a page a run
  read can't plant a rule that every later run follows.

## After the merge

Each run's details list the skills it loaded, and the weekly digest counts them and names the ones
no run loaded. One that stays unloaded for weeks needs a sharper description, or removing.
