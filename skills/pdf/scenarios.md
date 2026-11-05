# Scenarios: pdf

## Loads it
- "generate a sample pdf and give me"
- "make a PDF of this research I can read on my phone"
- "turn the trip plan into a PDF"
- "make the PDF shorter" (a new version of the last one)

## Not this one
- "summarise the PDF I sent" (reading one: the Read tool)
- "share the PDF as a drop" (the drop skill; this one only when the PDF must be made first)
- "why won't the PDF open in the chat?" (the chat's viewer: a question on shipify)

## Cases

### 1. A PDF written by hand
- **Ask:** "generate a sample pdf and give me".
- **Without it:** the run found no PDF library on the box and wrote the PDF's bytes by hand: 779
  bytes, one page of plain text, which it couldn't check in a viewer.
- **Done well:** the page as HTML in `$TMPDIR`, `node pdf.mjs` prints it to the out folder, the
  run reads the PDF's first page to check it, and names it in `files`.

### 2. No browser, and no way to get one
- **Ask:** "make a PDF of these notes", on a run with no network.
- **Without it:** not yet seen. The risk: a hand-made PDF again, or a reply that says a PDF was
  made when none was.
- **Done well:** the reply says the PDF couldn't be made, and why, and gives the HTML in `files`.
