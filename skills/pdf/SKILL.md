---
name: pdf
description: "Making a real PDF (a report, a guide, notes, a sample) with this skill's pdf.mjs: HTML printed by headless Chromium. Use when a run must hand over a PDF it makes, for the owner or a guest."
---

# Making a PDF

A PDF a run makes is written as a web page and printed by headless Chromium. Never write a PDF's
bytes by hand, and don't look for a PDF library: the box has none, and a hand-made PDF often
won't open on a phone.

## How

1. Write the page as one HTML file in `$TMPDIR`, not in the out folder: only the PDF goes to the
   person. Start from the page below.
2. Print it: `node <this skill's folder>/pdf.mjs $TMPDIR/report.html <out folder>/report.pdf`.
   It prints the PDF's path, size and pages, or what failed (exit 1). The first PDF of a slot
   installs the browser (about 30 s; a guest's run, every time).
3. Look at it: read the PDF's first pages (the Read tool shows them). Fix the HTML and print
   again when a page breaks badly, text overflows or a table is cut.
4. Name it in `files`. To change a PDF later, print a new version beside the old one
   (`report-v2.pdf`).

When it says it couldn't install the browser (no network, no room), say so plainly in your reply,
and give the HTML instead, named in `files`: it opens in any browser.

## The page

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>The title</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font: 11pt/1.5 system-ui, sans-serif; color: #111; }
  h1 { font-size: 20pt; margin: 0 0 4mm; }
  h2 { font-size: 14pt; margin: 8mm 0 2mm; break-after: avoid; }
  table { border-collapse: collapse; width: 100%; break-inside: avoid; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; }
  img, figure { max-width: 100%; break-inside: avoid; }
  .new-page { break-before: page; }
</style>
</head>
<body>
  <h1>The title</h1>
  <p>…</p>
</body>
</html>
```

- **Letter** for a US reader (`size: letter`), else A4.
- **Pictures:** a file beside the page (`<img src="chart.png">`) or a `data:` URL. A web address
  works too, but the page waits 10 s at most for it.
- **Sources:** research cites each source with its link, in a list at the end.
- **No scripts** are needed: what the page shows when it loads is what prints.
