---
when: every Monday at 9
---
Keep the lessons of the last two weeks, so none waits for me to start a task. On shipify, read
Shipify's own replies (by its `[bot]` account) on the issues of the last 14 days, read-only
(`gh api` on the repo's `issues/comments?since=…`), and take each line that starts
"Lesson for `<skill>`:". Leave out each lesson its skill's `SKILL.md` or `scenarios.md` already
holds, and each one a PR or a task of that time already took up, merged or not.

If any are left, ask for one work run on shipify that puts them into their skills the way
`skills/writing-skills` says, as one PR with `kind: part-of` (a `closes` PR's merge would close
this task, and that pauses this recipe). Its brief lists each lesson in short, with its skill and
its issue. If none are left, finish quiet.
