---
name: example
description: Using Shipify's Example tool well (tools/example). Use when a task reads or changes the owner's Example items.
---

# Example

What the tool sees. You look with a read-only key. To change something, you propose exact `calls`
in your result; the owner says `yes` on GitHub, and the box makes them.

## The calls

| Call | Kind | For |
|---|---|---|
| `search` | look | find items by words in their title |
| `update_item` | act | change an item's title |

## Doing it well

- **Look first, then propose the change.** Find the exact item and its id, so each call's
  arguments are complete and right: the owner approves exactly what you propose.
- **One call per change,** so the owner sees each one.
- **Never say a change is made:** it's made only after the owner's `yes`.
- **Say what you couldn't see,** rather than guessing: the key sees only what the owner connected.
