---
name: drop
description: "Using Shipify's Drop tool well (tools/drop, docs/tools.md). Use when a task shares files it made as a link, or lists, changes or revokes the owner's drops."
---

# Drop

Drop is the owner's own file sharing by link. Shipify's Drop tool makes a drop from files a task
shared, and answers with its link. You look with `drop.list`. To make or change a drop, you
propose exact `calls` in your result; the owner taps Yes (or says `yes`), and the box makes them
in a later run. You never make a change yourself.

## The calls

| Call | Kind | For |
|---|---|---|
| `list` | look | the drops (title, id, who may open it, PIN, people, expiry, requests) and the people in Drop; `query` finds one by title |
| `publish` | act | a new drop: `title` (120 characters at most), `files`, `share` (`me`, `view`, `add`, `collect`, `people`), `people` for `share: "people"`, `expiry` (`1d`, `7d`, `30d`, `keep`), `pin` |
| `update` | act | change a drop by its id: `share`, `people`, `remove` (people), `pin`, `new_link: true`. Not its title or expiry |
| `revoke` | act | delete a drop and its files: its links stop at once |

## Doing it well

- **Share the files in the same answer.** The owner's Yes comes in a later run, after your out
  folder is gone. So `publish`'s `files` names files the task shared: put each in your out folder,
  list it in `files`, and name it in the call by the same name (`report.pdf`, not a path). A name
  the task never shared is left out of the list, and the reply says so.
- **Map the owner's words to `share`:** "anyone can view" is `view`; "they can add theirs" is
  `add`; "collect photos from everyone" is `collect` (it needs no files); "only Mom and Dad" is
  `people` with `{"Mom": "view", "Dad": "view"}`; "just keep it for me" is `me`. No expiry said
  means `7d`; "keep it" is `keep`.
- **People by name:** `drop.list` ends with the people in Drop. Use a name from there, or an
  email. A name Drop doesn't have is refused when the call is made.
- **A link shows once.** Drop keeps only a link's hash, so `list` can't show it again. To send one
  again, `update` with `new_link: true`: say it stops the old link. A drop has one link at most;
  `share: "me"` stops it, and every person's access too.
- **A PIN goes with a link:** never with `share: "me"`. The box's reply gives the PIN once.
- **Find, then change.** `list` first for the drop's id, then `update` or `revoke` with it.
- **Say what will happen,** never that it's done or what the link is: the box lists your calls,
  and its reply after the Yes has the link and any PIN.
- **Not connected** or **refused the key** in an answer: tell the owner the setup step it names
  (docs/tools.md, Drop).
