# Scenarios: drop

## Loads it
- "make a PDF of this and share it, anyone can view, 7 days"
- "share the Diwali photos with Mom and Dad, keep them"
- "what drops do I have?"
- "revoke the Ladakh drop"

## Not this one
- "summarise the PDF I sent"
- "build Drop" (the app itself: a task on its own repo)
- "add Drop as a tool on a new copy of Shipify" (a setup: `pnpm ship add drop`)

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
