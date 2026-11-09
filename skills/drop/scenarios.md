# Scenarios: drop

## Loads it
- "make a PDF of this and share it, anyone can view, 7 days"
- "share the Diwali photos with Mom and Dad, keep them"
- "what drops do I have?"
- "revoke the Ladakh drop"
- "make a page of my trip plan"
- a guest: "make a page of our trip plan, and share it with Sam"

## Not this one
- "summarise the PDF I sent"
- "build Drop" (the app itself: a task on its own repo)
- "add Drop as a tool on a new copy of Shipify" (a setup: `pnpm ship add drop`)
- "make the playground's home page darker" (a change to a project, not a page to share)

## Cases

### 1. A file the task never shared
- **Ask:** "make a chart of this and share it".
- **Without it:** not yet seen. The risk: a `publish` call names `chart.png` with no file in the
  answer's `files`, or by its path; the call is left out, and nothing is shared.
- **Done well:** the chart in the out folder, `chart.png` in `files`, and the call names
  `chart.png`.

### 2. A link asked for again
- **Ask:** "send me the link to the Ladakh drop again".
- **Without it:** not yet seen. The risks: a `new_link` call, which stops the link already sent;
  an invented link, or one read from an old reply.
- **Done well:** `list`, and the link it shows, with no call. Only when `list` says the link is
  from before Drop kept links: `update` with `new_link: true`, saying the old link stops.

### 3. A file replaced in a drop
- **Ask:** "put the new report in the Ladakh drop instead of the old one".
- **Without it:** not yet seen. The risk: `files` alone, so Drop keeps both, the new one with a
  number in its name.
- **Done well:** the report in the out folder and in `files`, and one `update` with
  `delete_files: ["report.pdf"]` and `files: ["report.pdf"]` (it deletes first, then adds).

### 4. A file the owner sent, shared
- **Ask:** "share this as a drop", with a zip attached in the web chat.
- **Without it:** not yet seen. The risk: the zip copied into the out folder, so it lands on the
  `shipify-files` branch for good, and over 25 MB it isn't shared at all.
- **Done well:** one `publish` whose `files` names the zip by the ref the box's notes give it
  (`web:f-…`); the box fetches it and gives it to Drop.

### 5. A page asked for, with no word of sharing
- **Ask:** "make a page of my trip plan: Goa, 12-14 Dec … Add a packing checklist I can tick."
- **Without it:** seen in a baseline with the skill as it was: the page came back as a file
  only, with no `publish`, as the owner hadn't said "share". The reply offered a Drop link if the
  owner asked for one: a second message for what the page ask meant.
- **Done well:** `trip.html` in the out folder and in `files`, and one `publish` naming it, with
  `share: "me"` and `expiry: "7d"`, with no look first. The reply says what the page holds and that
  its link opens it in Drop; the box adds the link, and the file leaves the reply.

### 6. A guest's page, shared with someone
- **Ask:** a guest: "make a page of our trip plan, and share it with Sam".
- **Without it:** not yet seen. The risks: a `publish` with `share: "people"` or `people`, which
  fits no guest form, so the box leaves it out and the page stays a file only; or `share` left
  out, which fits no form either, as the form fixes `share: "me"`.
- **Done well:** the page in the out folder and in `files`, and one `publish` with
  `share: "me"`, `title` and `files`. The reply says the page opens only to them, and how to share
  it with Sam: Manage it in Drop → **Share** → People (Sam signs in with Google), or a link.

### 7. A file with no word of who
- **Ask:** "put the report in Drop".
- **Without it:** not yet seen. The risk: `share: "view"` by habit, so a link anyone can open goes
  out though the owner never said so.
- **Done well:** one `publish` with `share: "me"` (or none: the tool makes it only the owner's).
  The reply says only they can open it, and how to share it.
