---
status: accepted (merged #508) and built; see [As built](#as-built-2026-10-17)
date: 2026-10-17
amends: 0020 (the slot count is a suggestion, not a cap), 0060 (a slip in an answer's shape keeps its stay)
---

# 0061: Steady runs and roomy boxes

## The plan in short

Runs:
1. **The valid answer wins.** The box takes the agent's valid answer, never a stale file it wrote
   before.
2. **A slip in an answer's shape keeps its stay.** The Failed reply tells you once, and your next
   words go to the same session.
3. **Content too long for its field goes into a file**, and the field says where.
4. **A big change starts as a proposed ADR:** the options and open questions, on GitHub, changed on
   the same branch until it settles. Your merge accepts it.

Boxes:
5. **zram on a box with no swap.** When tasks overlap, they slow down instead of being killed.
6. **`--slots` has no hard cap.** Above the count its memory suggests, or above its cores, `box add`
   warns, and it doesn't refuse.
7. **`ship doctor` reports memory:** swap, each slot's peak, and any out-of-memory kill.

Nothing else: no per-slot memory limits, no fstab change, no new `ship` command, and no new runner.
The load test on homepi (below) is what these rest on.

## Context

- On 17 Oct, run 39019880462 on #506 failed with "work.brief: Too big". The agent had written
  `out/result.json` with a 2,072-character brief. Claude's `StructuredOutput` refused it, and the
  agent sent a fixed answer 13 s later. But `answer()` (`cli/kernel/think.ts`, "What it left, taken
  back") takes a written file first, so the box took the stale one. The slip then counted as a stop
  (`stopOf` gives `no-answer`), and `staysAfter` (`cli/kernel/stay.ts`) ends a stay that has
  `meta.stopped`, so the session went down. Decide logged "1 writes", with no "then it stays".
- In the same task's other runs, the stay rules worked: the run that opened #507 stayed ("3 writes,
  then it stays"), and the run that handed over to a work run ended, as it should (ADR 0060).
- Boxes get a slot count from their memory (`slotsFor`, `cli/commands/box.ts`), capped at 4
  (`MAX_SLOTS`). The 1.7 GB peak behind it was measured once (ADR 0020). Ubuntu's Pi image and most
  VPS images have no swap, so a box that runs short has a test killed, not slowed.
- The owner wants every box used well, without a fixed cap, and proved by a test (#506).

## Assumptions, checked

| Assumption | How it was checked |
|---|---|
| A stale `result.json` beat a valid final answer | Run 39019880462's log: `Write: …/out/result.json`, then `StructuredOutput` ✗ "got 2072", then a second `StructuredOutput` |
| A shape slip ends the stay; a PR and a question don't | Decide's log lines on #506's runs: 39019880462 "1 writes" (no stay), 39020720722 "3 writes, then it stays" |
| The agent runs inside its slot's service, so the slot's cgroup counts the agent and its tests | homepi: no `pam_systemd` in sudo's PAM stack (`/etc/pam.d/sudo`, `common-session-noninteractive`); each slot is `/system.slice/shipify-box-<name>.service` |
| homepi has room today | homepi, 17 Oct: 7.8 GB, 4 cores, no swap, 0 OOM kills in 14 days, memory pressure 0. Slots' peaks since 11:48: 0.47, 0.87 and 1.14 GB (the last a shipify work run with `make verify`) |
| What N tasks at once cost | the load test below, on homepi: about 1.0 GB a task's checks; the cores are the limit past 3 |
| zram is there on Ubuntu 24.04 | `modinfo zram` on homepi (6.8.0-1065-raspi); `systemd-zram-generator` 1.1.2 is in the archive (`apt-cache policy`) |
| zram's settings | the generator's own default is `min(ram / 2, 4096)`; the Arch wiki's zram page and Pop!_OS use `vm.swappiness=180` and `vm.page-cluster=0` for swap in RAM (the kernel allows 0 to 200) |
| `CPUWeight` needs no setting | `systemctl show`: not set on the slots, so each gets the default weight, 100: the cores are already shared fairly |
| WSL has swap of its own | WSL 2 makes a swap file by default (`.wslconfig`, `swap`), so the "a box with swap is left alone" rule covers it |
| Docker can't take zram | no systemd in the container (ADR 0056); its memory is the host's and `--memory`'s |

## The load test (homepi, before)

The links app's `make verify` (format, lint, types, unit tests, build, then Playwright's browser
tests on 2 workers, the heaviest step a task takes), N copies at once, each in its own user service
so each has its own memory count. A guard stops them all if free memory falls under 700 MB. The
agent's own memory is not in it: add about 0.4 GB per slot (ADR 0020).

Run on 17 Oct, 15:13 to 15:30 IST, with no task running on the box, and no swap:

| At once | Time (alone: 129 s) | Each copy's peak | Lowest free memory | OOM kills | Tests |
|---|---|---|---|---|---|
| 1 | 129 s | (not read) | 5.99 GB | 0 | all passed |
| 3 | 161 s (1.25×) | about 1.0 GB | 4.09 GB | 0 | all passed |
| 4 | 232 s (1.8×) | 0.95 to 0.97 GB | 3.36 GB | 0 | all passed |
| 5 | 302 s (2.3×) | 0.96 to 1.02 GB | 2.53 GB | 0 | one browser test timed out at 30 s (an accessibility scan, CPU-bound) |

What it shows:
- **A task's checks peak at about 1.0 GB**, not 1.7. With the agent (about 0.4 GB) and its idle
  runner (about 0.2 GB), a busy slot needs about 1.6 GB, so the rule of 2 GB per slot holds with room.
- **On a 4-core Pi, the cores run out before the memory.** The time per task is 129 s alone and
  54, 58 and 60 s at 3, 4 and 5 at once: past 3, more checks at once give no more done per minute,
  each just takes longer, and at 5 a timed test failed. A slot's agent mostly waits on its model,
  so slots past the cores still help as long as their checks don't all overlap.
- **Memory has room at 5, but only just with the agents:** 2.5 GB free minus 5 agents' 2 GB.
  Swap is the safety net for that: a short overlap slows down instead of being killed.
- The per-copy peak comes from each copy's own cgroup (`memory.peak`, read every second). A box's
  runs set `CI`, which gives a browser test one retry, so the timeout at 5 might have passed
  there. The test didn't set it, so its numbers are the harder case.

## Options

Runs:
- **A: The valid answer wins, and a slip keeps the stay.** (+ a fix of about 10 lines; it follows
  the rule that the harness retries nothing and tells you once / − a slip still shows as Failed
  until you answer)
- **B: The box gives the agent a fix round when the shape is wrong.** (+ fixes a slip by itself /
  − a retry by the harness, which the owner ruled out; Claude already retries by itself)
- **C: Raise the field caps.** (− it only moves the limit, and a long brief costs every later run's
  prompt)

Pre-plan docs:
- **A: A proposed ADR** (the template's `status: proposed`) with the options and open questions.
  (+ one kind of doc, no step that turns a draft into an ADR)
- **B: A new `docs/drafts/` folder** (PR #507's). (− a second kind of doc and a step that turns it
  into an ADR)

Boxes:
- **A: zram where there's no swap, no hard cap, and a memory line in the doctor.** (+ one OS change;
  tasks slow down instead of dying; nothing reserved / − zram costs CPU when it's used)
- **B: A also gives each slot `MemoryHigh` or `MemoryMax`.** (+ a runaway stays in its slot / − it
  slows a task that runs alone, and needs tuning per box; nothing has run away yet)
- **C: As today.** (− a fixed cap and no swap: a test killed when tasks overlap)
- **D: Ephemeral runners or a container per run.** (+ no idle cost / − a new moving part (a
  dispatcher), more memory per run; cores and memory, not isolation, are the limit)

## Decision

Chosen **A** in each part. They're the smallest changes that fix the failure and the overlap,
and they work the same on any box. B for boxes comes back only if the doctor's line shows an
out-of-memory kill.

1. **The valid answer wins** (`cli/kernel/think.ts`, `answer()`): read the written file and the
   final answer. Take a valid written file; else a valid final answer; else the written file, so the
   error names what the agent wrote. When both are valid and differ, the file wins (as today).
2. **A slip keeps the stay:** a result with `wrong` (its shape) and a live session isn't a stop.
   `stopped` stays for a real stop: your `stop`, the clock, the plan's limit, a crash, or no answer
   at all. The reply is unchanged ("The agent's answer didn't fit Shipify's shape… what the agent
   said"). Your next words, `continue` or anything, go to the same session.
3. **Long content goes into a file:** one line in the prompt's result fields and in
   `playbooks/task.md`. On a work run, a doc in the clone, committed. On a talk run, a file in the
   out folder, named in `files`. The field holds a summary and the path.
4. **A proposed ADR as the pre-plan:** `playbooks/task.md`'s big change says so. While options are
   open, the ADR holds them and its open questions. Later runs change it on the same branch, and the
   owner's merge accepts it.
5. **zram, from `box/setup.sh`:** on a box with systemd and no swap, install
   `systemd-zram-generator`, and write `/etc/systemd/zram-generator.conf` (`zram-size = min(ram / 2,
   8192)`, `compression-algorithm = zstd`) and `/etc/sysctl.d/90-shipify-zram.conf`
   (`vm.swappiness = 180`, `vm.page-cluster = 0`). Each file has the "Written by `ship box`" header.
   A box with swap, a container, or a box without systemd skips it, with one line saying why. It
   never makes `box add` fail. Running it again changes nothing.
6. **No hard cap:** `--slots` takes any whole number from 1. Above `slotsFor`'s count (memory)
   or above the box's cores, `box add` warns: "N slots on X GB and C cores: tasks whose checks
   overlap get slower. `pnpm ship doctor` shows if a slot ran short." `slotsFor` stays the
   default (1 GB for the system, then 2 GB per slot, which the load test confirms), capped at 4:
   your Claude plan's limits, then the cores, usually decide how many tasks run at once.
7. **The doctor's memory line** (`cli/lib/box-facts.ts`, the existing `memory` fact) adds the swap
   (none, zram or a file), each slot's peak since it started and any OOM kill (from each slot's
   `memory.peak` and `memory.events`). A kill sets `look`: "slot <k> had a task killed for memory:
   fewer slots, or swap".

## Edge cases

- **Both answers invalid:** the written file's error, as today.
- **The agent never wrote a file:** as today (the final answer, else the words).
- **A slip on a run with no session** (an adapter without one): no stay, as today.
- **A slip, then your `stop`:** a real stop, so no stay.
- **zram on a box that later gets a swap file:** both work. The doctor names the swap.
- **The generator's package missing** (an old or unusual image): skipped with a line. The box works
  as today.
- **A kernel without zram** (some WSL kernels, some VPSs): WSL has swap, so it's skipped; a VPS gets
  the line "no zram in this kernel: tasks that overlap may be killed; fewer slots, or swap".
- **Many slots on a small box:** the warning at `box add`, then the doctor's kill line if a slot ran
  short. Nothing refuses.
- **More slots than cores:** checks that overlap get slower, as the load test shows; a timed
  browser test can fail, and `continue` runs it again. The warning names it.

## Setup

Nothing new: `pnpm ship box add <box> --yes` again on each box (it keeps the slot count). Then
`pnpm ship doctor` shows `memory … swap: zram 3.9 GB`.

## Docs and clean-up

- `docs/box-setup.md`: "Slots: several tasks at once" (zram, no hard cap, the measured numbers);
  "Looking after it" (the memory line).
- `docs/adr/0020-slots.md`: "amended by 0061" in the README's table.
- `docs/adr/0060-every-answer-stays.md`: "amended by 0061" (a slip keeps its stay).
- `docs/tasks.md`: "Every run ends in a reply" (a slip keeps the stay).
- `playbooks/task.md`: the pre-plan line and the long-content line.
- `cli/kernel/prompt.ts`: the long-content line by the result's fields.
- `docs/settings.md` only if a new setting appears (none planned).
- `CHANGELOG.md`.
- PR #507 and its `docs/drafts/` folder are closed by the owner; nothing of it lands.

## Consequences

- A shape slip that the agent fixed itself no longer fails, and one it didn't fix costs one reply
  in the same warm session.
- A box with no swap gains about half its RAM as compressed swap, so overlap costs time, not a test.
- A bigger box can take more slots without a code change.
- zram uses CPU while it swaps, on a box whose cores are already the limit when checks overlap. It
  only works when memory runs short, which the load test didn't reach at 5.
- homepi stays at 3 slots: the load test shows that's where its cores give the most done per minute.
- The doctor has one more thing to say, from files it already reads.

## Confirmation

- Tests: `answer()` with a stale invalid file and a valid final answer gives the final answer; both
  valid gives the file; both invalid gives the file's error (`tests/kernel-think*` or the nearest).
  `staysAfter` with a slip and a session stays; with a clock stop it doesn't
  (`tests/kernel-stay.test.ts`). `--slots 6` warns and doesn't refuse; the zram step's lines for
  swap, container and no systemd (`tests/box-setup.test.ts`). The memory fact with a kill sets
  `look`.
- The load test lands as `box/load-test.sh` (run as the box's own login, no root; N copies of an
  app's `make verify`, each in its own user service; a guard stops them when free memory falls
  under 700 MB). On homepi, after the build: `box add` again, then the same test at 3, 4, 5 and 6
  at once; the numbers go into "As built" here. Then `ship selftest`, `selftest claude`, and
  `make verify` in each app.

## Build

- [x] T1 `answer()` takes the valid answer; a slip isn't `stopped` (`cli/kernel/think.ts`), test-first
- [x] T2 The long-content line (`cli/kernel/prompt.ts`, `playbooks/task.md`); the pre-plan line
- [x] T3 zram in `box/setup.sh`, idempotent, with its skips
- [x] T4 `--slots` warns past `slotsFor` (`cli/commands/box.ts`)
- [x] T5 The doctor's memory line (`cli/lib/box-facts.ts`)
- [x] T6 `box/load-test.sh`; homepi: `box add` again, the test after, "As built"; the docs pass; changelog

## As built (2026-10-17)

Built in #509, with its follow-ups in the PR after it. What differs from the decision:
- **The slots' memory is a line of its own** (`slots`) in `box health` and on the status task,
  beside the memory line, which names the swap. A kill sets `look`, so it comes as a comment.
- **`box add`'s plan names the zram step,** and the box setup is version 6: `ship doctor` names a
  box set up before it.
- **`box/here.sh` takes any `--slots` from 1** too (it said 1 to 4), and `docs/design.md` no longer
  says a box has 1 to 4 slots. In Docker, the swap is the host's (`docs/box-setup.md`).
- **`box/load-test.sh` waits for the disk** (`sync`) after making its copies: on homepi's USB
  stick, a round that started while the copies were still being written failed its first unit
  tests (5 s timeouts) with 6 GB free.

On homepi, after `box add` from `main`: zram 3.8 GB (`zstd`), `vm.swappiness` 180,
`vm.page-cluster` 0; the three slots kept their `sandbox` label; `box health` showed
`swap: zram 3.8 GB` and each slot's peak. `ship selftest`: 26 checks passed. `selftest claude`: 4
passed, the stay included.

The load test after, the same links app's `make verify`, with zram:

| At once | Time | Each copy's peak | Lowest free memory | OOM kills | Tests |
|---|---|---|---|---|---|
| 1 | 68 s | 1.08 GB | 5.87 GB | 0 | passed |
| 3 | 158 s | 0.95 to 0.98 GB | 4.05 GB | 0 | all passed |
| 4 | 218 s | 0.98 to 1.08 GB | 3.17 GB | 0 | all passed |
| 5 | 275 s | 1.00 to 1.09 GB | 2.53 GB | 0 | all passed |
| 6 | 343 s | 0.93 to 1.04 GB | 1.42 GB | 0 | 5 of 6 failed one browser test at its 30 s timeout (the accessibility scan) |

zram held 512 KB when read during the rounds and 3 MB after the last: it was barely used.

What it shows:
- **zram costs nothing while memory has room:** 3, 4 and 5 at once took 158, 218 and 275 s,
  against 161, 232 and 302 s without it, and every copy passed at 5 (one timed out before).
- **The cores are the limit on a 4-core Pi, not memory:** at 6 at once, 1.4 GB was still free and
  zram held 3 MB, but the CPU-bound browser test ran out of time. homepi stays at 3 slots; `box add`
  warns past 3 on it (its memory fits 3).
- The time alone (68 s here, 129 s before) depends on how much of the app the disk cache holds;
  the times at once compare like with like.
