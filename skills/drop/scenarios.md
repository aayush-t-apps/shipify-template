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
- **Without it:** not yet seen. The risk: an invented link, or one read from an old reply.
- **Done well:** `list` for its id, then `update` with `new_link: true`, saying the old link stops.
