---
status: accepted (the owner chose it, 2026-10-02; merging its PR accepts it)
date: 2026-10-02
---

# 0025: A task's model: the form's Model field or a `use` comment, kept in its record and shown on its status

## Context
ADR 0021 let the owner pick a task's agent, model and effort with `use` lines: the box scanned the
task's text and every comment of the owner's for a line of its own like `use opus`. In #62 the
line ended the last line of the form (`lnk.app.a69x.in use opus`), so it didn't count, and the
task ran on Auto. Nothing said so until the run's details.

That was the protocol's fault, not the owner's:
- **a hidden rule:** where the line had to be;
- **no confirmation** before a run;
- **worked out again from all the text every round,** instead of kept once.

The owner asked for a proper protocol, and chose a form field plus a command over a command only
or labels. That reverses part of 0021, which had dropped model fields from the forms.

## Decision
- **The choice lives in the task's record** (the status comment's state): `use` holds the agent,
  model, effort, and the label it shows. Every round runs on it: the plan, each change, an approved
  errand, the build after a plan merges, a repeat's job. With none, it's the default agent's Auto.
- **When the task opens:**
  - the four forms that run the agent (Change, New project, Question, Repeat) have one optional
    **Model** dropdown: Auto (the default), Opus, Opus high, Sonnet;
  - a blank issue (the GitHub app can't fill in forms) can make its first line `use opus`.
- **Later:** a comment that's just `use <choice>` is a box command, like `preview` or `again`.
  - The box keeps it, replies "From the next round: Opus", and runs nothing.
  - Posted together with a request, that round runs on it.
  - One that names nothing is refused, with the choices, and changes nothing.
- **The status comment shows the choice** beside the project: "Needs you · links · new · Opus".
  Its help line says how to change it.
- **No other text is read for a model.** The words follow 0021's rule: an agent, one of its models
  (or a model id its pattern takes), one of its efforts, or `auto`, three words at most. Naming
  another agent starts its model and effort afresh.
- **Recognising a form** (`readForm`): a dropdown with a default doesn't count toward a match, since
  every issue from its forms has it. A plain issue with a `### Model` heading isn't a form.
- **A test checks** that every form's Model choice is one the real `executors.json` takes.

## Options
- **Command only** (+ no form change / − nothing to pick when opening a task, so it's easy to
  forget).
- **Labels** (+ a click, visible in the issue list / − made per model, nothing to type a model id
  or an effort with).
- **Keep scanning text, but more leniently** (#64) (+ no new step / − still a hidden rule, and still
  no confirmation). Closed in favour of this.

## Edge cases
- **Open tasks from before** have no choice in their record: they run on Auto until a `use`
  comment. A `use` line inside their text is no longer read.
- **An unknown model in a later `executors.json`:** the form's choice would fail the test above
  before it ships.
- **A choice the agent can't use** (not installed on the box) runs on Auto, and the run's details
  say why (as in 0021).
- **A `use` comment on a closed task** changes nothing until a later comment carries the task on.
  That round then takes it, oldest first.
- **Several `use` comments at once** apply in order; the newest wins.

## Consequences
- **Easier:**
  - the model is picked where the task is written;
  - it's confirmed at once, and seen on the status comment;
  - the same choice carries through every round.
- **Harder:**
  - one more field on four forms;
  - the forms' choices follow `executors.json` by hand, kept honest by a test.

## Confirmation
- `tests/agents.test.ts`:
  - choices from words;
  - a command only as a whole text;
  - the forms' choices against `executors.json`.
- `tests/task-run.test.ts`, against the fake GitHub and agent:
  - a blank issue's first line;
  - the form's field, with Auto meaning none;
  - a `use`-only comment confirmed with no agent run;
  - a refused one;
  - the next round on the record's choice, with a `use` line inside a request ignored;
  - the status comment's label.
- `tests/task.test.ts`:
  - the agent forms ask for Model and the box's own forms don't;
  - a `### Model` heading alone is no form.
