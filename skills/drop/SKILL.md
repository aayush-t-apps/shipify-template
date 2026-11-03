---
name: drop
description: "Using Shipify's Drop tool well (tools/drop, docs/tools.md). Use when a task shares files it made as a link, or lists, changes or revokes the owner's drops."
---

# Drop

Drop is the owner's own file sharing by link. Shipify's Drop tool makes a drop from files a task
shared, and answers with its link. You look with `drop.list`. To make or change a drop, you
propose exact `calls` in your result, and the box makes them. A `publish` is pre-approved
(`tools.json`): when the owner's words ask for it and the run read nothing from outside, the box
makes it in the same run, with no `yes`. Every other call waits for the owner's Yes (or `yes`),
and the box makes it in a later run. You never make a change yourself.

## The calls

| Call | Kind | For |
|---|---|---|
| `list` | look | the drops (title, id, who may open it and its link, PIN, people, expiry, requests), the space they use of Drop's cap, and the people in Drop; `query` finds one by title, and then shows its files with their sizes, limits and who asks to open it |
| `publish` | act | a new drop: `title` (120 characters at most), `files`, `share` (`me`, `view`, `add`, `collect`, `people`), `people` for `share: "people"`, `expiry` (`1d`, `7d`, `30d`, `keep`), `pin` |
| `update` | act | change a drop by its id: `title`, `expiry` (from now), `limits` (`{"mb": 1 to 2000, "files"}`), `files` (to add), `delete_files`, `share`, `people`, `remove` (people), `requests` (`{"<email that asked>": "view", "add" or "deny"}`), `pin`, `new_link: true` |
| `revoke` | act | delete a drop and its files: its links stop at once |

## Doing it well

- **Share the files in the same answer.** The box makes calls after your out folder is gone. So
  `files` (in `publish` or `update`) names files the task shared: put each in your out folder,
  list it in `files`, and name it in the call by the same name (`report.pdf`, not a path). The box
  shares them before it makes the call. A name the task never shared is left out, and the reply
  says so.
- **A file the owner sent, by its ref.** To share a file the owner sent through a chat (a zip, a
  report, a photo), name it in `files` by the ref the box's notes give it (`web:f-…`), not a copy
  in your out folder: the box fetches it from the web chat's store and gives it to Drop, and no
  copy lands on the `shipify-files` branch. Only refs on this task's own messages count.
- **A new drop needs no look.** For "make a sample doc and share it", make the file and propose
  `publish`: no `list` first. Any look (`list` too) makes it wait for a Yes. Take people's names
  from the owner's words; a name Drop doesn't have is refused when the box makes the call.
- **Map the owner's words to `share`:** "anyone can view" is `view`; "they can add theirs" is
  `add`; "collect photos from everyone" is `collect` (it needs no files); "only Mom and Dad" is
  `people` with `{"Mom": "view", "Dad": "view"}`; "just keep it for me" is `me`. No expiry said
  means `7d`; "keep it" is `keep`.
- **People by name:** `drop.list` ends with the people in Drop. Use a name from there, or an
  email. A name Drop doesn't have is refused when the call is made.
- **The link is in `list`.** Drop keeps each drop's link, so "send me the link again" is a look:
  give the link `list` shows, and change nothing. A drop has one link at most, and a change of
  `share` keeps it, with the new rights: from `view` to `add`, say a link already sent can add
  files too. `new_link: true` stops the old link; propose it only when the owner wants that, or
  when `list` says the link is from before Drop kept links.
- **Delete by the name in the drop:** `delete_files` takes the names Drop has (a file added twice
  gets a number). `update` with `files` adds; it never replaces a file of the same name.
- **A PIN goes with a link:** never with `share: "me"`. The box's reply gives the PIN once.
- **Find, then change.** `list` first for the drop's id, then `update` or `revoke` with it.
- **Say what will happen,** never that it's done or what the link is: the box adds the link and
  any PIN to the reply once it makes the call (at once for a `publish`, else after the Yes).
- **Not connected** or **refused the key** in an answer: tell the owner the setup step it names
  (docs/tools.md, Drop).
