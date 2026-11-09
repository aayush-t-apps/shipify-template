---
name: drop
description: "Using Shipify's Drop tool well (tools/drop, docs/tools.md). Use when a task shares files it made as a link, makes a page the owner or a guest asked for, or lists, changes or revokes the owner's drops."
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
  `people` with `{"Mom": "view", "Dad": "view"}`; "just keep it for me" is `me`. **No who said is
  `me`,** for any drop, a page or a file (ADR 0073): every new drop is only its owner's until they
  share it. Then say so, and how to share it: on its page in Drop, or ask for anyone with the link
  or names. No expiry said means `7d`; "keep it" is `keep`.
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

## A page

A page (ADR 0072) is one `.html` file you make when the owner asks for one ("make a page of my
trip plan"): the `frontend-design` skill's "A one-file page" says how. Drop shows it, sandboxed,
with **Share** at the top for the owner.

- **Asking for a page asks for its drop,** even when the owner doesn't say "share". Put the page
  in your out folder, name it in `files`, and propose one `publish` in the same answer, naming it
  the same way, with no look first: the box makes it at once. `share: "me"` unless the owner said
  who; no expiry said is `7d`.
- **One page alone in its drop:** then its link opens the page itself. With other files beside it,
  the link opens the drop's list.
- **The reply is its link.** When the call works, the box leaves the page out of the reply's files
  and puts the call's answer, with Drop's link, in the reply. So say what the page holds, and that
  its link opens it in Drop. Don't paste the HTML, write a link, or say "see the file". When the
  call fails or waits for a Yes, the page shows as a file, and the reply says why.
- **A change keeps the link.** "Add Tuesday's dinner": the page isn't in the chat's files, but it
  is under "Files earlier runs made" in your prompt, so read it from there. Change it, save it
  under the same name, `list` for the drop's id, and propose one `update` with
  `delete_files: ["trip.html"]` and `files: ["trip.html"]` (it deletes first, then adds). It waits
  for the owner's Yes, as every change does.
- **A page from the web** (the run read a site or searched): its `publish` waits for a Yes too.
  Say so.

## A guest's page

A guest's run (`playbooks/guest.md`) has no tool and no look. When its prompt's `calls` line
names Drop's guest forms (ADR 0073), the box makes them at once, for that guest alone:

- **A page:** one `publish` in the same answer, with `share: "me"` always, `title`, `files`, and
  `expiry` `1d`, `7d` or `30d` (`30d` when none was said). Nothing else fits: no `people`, `pin` or
  other `share`. The drop opens only to the guest, and the box adds its link and "Manage it in
  Drop" (their **My drops**).
- **"Change it":** one `update` by the link or id in the chat, with `delete_files` and `files`
  (the page saved under the same name), or `title`. Nothing else fits. Only a drop made for the
  guest changes.
- **Sharing is in Drop, never a call:** "share it with Sam" or "anyone can view" get the steps:
  Manage it in Drop → **Share** (a link, or people by email, who sign in with Google).
- **The page stays in their chat** as well: say what it holds, and that its link opens it in Drop.
