# Checks

A check watches one value for a repeat (`repeat: every hour, check <name>`, or the Repeat form's
Check field). Each is a script here, `checks/<name>.mjs`, merged by PR like any change to Shipify:

- It prints the value to watch on stdout (4 KB at most) and exits 0. A run replies only when the
  output differs from the last one; a non-zero exit, or more than a minute, is a failure: said as
  **Failed** with its cause, never as a change. Three in a row pause the repeat, and that reply
  says so; one that runs starts the count over.
- It runs on a box as the slot's own agent user, from a read-only copy of Shipify, with no keys and
  no access to the runner's folders. It may read the web.
- Plain Node (no TypeScript, no packages beyond Node's own), so it runs as it is.

`example.mjs` is one to copy.
