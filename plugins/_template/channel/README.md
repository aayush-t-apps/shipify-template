# A new chat channel: the checklist

A chat channel is one adapter in the edge that answers four questions for its platform: is this
webhook really from you (`verify`), what did the person say (`parse`), send this reply (`send`), and,
if it can, fetch this file (`file`) and how are you (`health`). Its contract:
[edge/src/channels/channel.ts](../../../edge/src/channels/channel.ts). The whole story:
[docs/channels.md](../../../docs/channels.md#adding-another-channel).

1. **The adapter:** copy `adapter.ts` here to `edge/src/channels/<id>.ts`. It imports only
   `./channel.ts`, `../env.ts`, `../push.ts` (Web Push, for a chat read in place) and
   `cli/contracts/` (`tests/architecture.test.ts` checks it). Its
   secrets are named in `needs`, and its chats' shape in `chatId`.
2. **One line** in `edge/src/channels/index.ts`: `{ telegram, <id> }`. Its route is
   `POST /door/<id>`.
3. **Its fixtures:** copy `fixtures.ts` here to `tests/edge/channels/<id>.ts` (webhooks as the
   platform sends them, and a stand-in for its API), and list it in `tests/edge/channels/index.ts`.
   Then `pnpm vitest run tests/edge/channels.test.ts` runs the same checks every adapter passes.
4. **Its setup:** a `tools.json` entry with `"in": { "door": "<id>" }` and its `setup` (`needs`,
   `keys` with `to: "worker"`, its steps: the token, pointing its webhook at the edge's
   `/door/<id>`, linking you into `SHIPIFY_PEOPLE` under `on.<id>`, a test message). Telegram's entry and `tools/telegram/setup.ts` are the example.
5. **Docs:** its column in the table at the top of `docs/channels.md`, and its setup in
   `docs/setup.md`.
6. **Check:** `pnpm verify`, merge, `pnpm ship add <id> --yes`, then `pnpm ship selftest chat`.

**Buttons** (ADR 0042), where the platform has them: a button is a label and the exact words it
sends. Show a reply's `buttons` (and an answer's), read a tap as a Message whose words are the
button's, replying to the message it sat on (`readHead` finds the task) with `tap` set, acknowledge
it in `tapped`, and set `limits.button`. Its fixtures get a `tap`; the suite checks a tap reads as
the words typed and every button fits. Without buttons, the words are in the text, to type.

An **out-only channel** (Notion, an Obsidian vault) has `send` alone: leave out `verify`, `parse`,
`answer` and `file`.
