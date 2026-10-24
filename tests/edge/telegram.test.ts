// What a Telegram update says and how a reply looks there (edge/src/channels/telegram.ts, the
// adapter), what a message means to Shipify (edge/src/chat.ts), and the answers every channel shares
// (cli/contracts/answers.ts): pure functions.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  acknowledgement,
  agentsSeen,
  appsText,
  CHATS,
  cut,
  groupOf,
  helpText,
  instantOf,
  LIST_HEAD,
  LIST_MAX,
  line,
  MOST_LIST,
  modelSearches,
  modelsButtons,
  modelsFound,
  modelsText,
  notebookText,
  pickIn,
  pickOf,
  pingText,
  type ReplyLine,
  recipesText,
  tasksText,
  useTimeZone,
  withUpcoming,
  effortsFor,
  type AgentSeen,
} from "../../cli/contracts/index.ts";
import { loadIntents } from "../../cli/lib/intents.ts";
import type { Message } from "../../edge/src/channels/channel.ts";
import {
  chatFormat,
  failureOf,
  MAX_SENT,
  mediaOf,
  parse,
  render,
  senderOf,
  shorten,
  type TgMessage,
} from "../../edge/src/channels/telegram.ts";
import {
  bareCommand as bareOf,
  fromCommand,
  linkCode,
  NEEDS_WORDS,
  outgoingOf,
  startOf,
  taskOf as taskIn,
  textOf as textIn,
  titleOf,
} from "../../edge/src/chat.ts";
import { chatsIn, parsePeople, toBoxes } from "../../edge/src/settings.ts";

/** A Telegram message as the door reads it: through the adapter, into one Message. */
const asMessage = (m: TgMessage) => parse(JSON.stringify({ update_id: 1, message: m })) as Message;
/** The commands the door answers itself, as it reads them. */
const ownCommand = (t: TgMessage) => {
  const m = asMessage(t);
  if (m.forwarded) return null;
  const start = startOf(m);
  return start ? { name: "start", rest: start.rest } : instantOf(m.words);
};
const bareCommand = (t: TgMessage) => bareOf(asMessage(t));
const taskOf = (t: TgMessage) => taskIn(asMessage(t));
const textOf = (t: TgMessage) => textIn(asMessage(t));
const renderReply = (r: ReplyLine, task: number, words: string, on: string) =>
  render(outgoingOf(r, task, words, on));

const BOT = { is_bot: true };
const msg = (m: Record<string, unknown> = {}): TgMessage =>
  ({ message_id: 9, chat: { id: 5, type: "private" }, from: { id: 5 }, text: "hi", ...m }) as never;

describe("what a Telegram update says", () => {
  it("reads only a message with its ids and chat", () => {
    const good = { update_id: 832211907, message: msg() };
    expect(parse(JSON.stringify(good))?.id).toBe("832211907");
    expect(parse("{}")).toBeNull();
    expect(parse("null")).toBeNull();
    expect(parse(JSON.stringify({ update_id: 1.5, message: msg() }))).toBeNull();
    expect(parse(JSON.stringify({ update_id: 1, edited_message: msg() }))).toBeNull();
    expect(
      parse(JSON.stringify({ update_id: 1, message: { ...msg(), chat: { id: 1 } } })),
    ).toBeNull();
    expect(senderOf(msg())).toBe(5);
    expect(senderOf(msg({ chat: { id: -3, type: "group" } }))).toBeNull();
  });

  it("reads the bot's own commands, whatever follows them, and nothing else", () => {
    expect(ownCommand(msg({ text: "/start abc.def more" }))).toEqual({
      name: "start",
      rest: "abc.def more",
    });
    expect(ownCommand(msg({ text: "/Apps@shipify_bot" }))).toEqual({ name: "apps", rest: "" });
    expect(ownCommand(msg({ text: undefined, caption: "/help\nplease" }))).toEqual({
      name: "help",
      rest: "please",
    });
    for (const text of ["/appsx", "/status", "please /apps", "/new x", "ping", "/pingx"])
      expect(ownCommand(msg({ text }))).toBeNull();
    expect(ownCommand(msg({ text: "/apps", forward_date: 1 }))).toBeNull();
  });

  it("reads a menu command alone (intents.json's chat commands), with no words, file or forward", () => {
    const chats = Object.values(loadIntents().intents).flatMap((i) => (i.chat ? [i.chat] : []));
    expect(CHATS.map((c) => c.chat).sort()).toEqual([...chats].sort());
    expect(bareCommand(msg({ text: "/new" }))).toBe("new");
    expect(bareCommand(msg({ text: " /New@shipify_bot\n" }))).toBe("new");
    for (const m of [
      { text: "/new x" },
      { text: "new" },
      { text: "/notamenucommand" },
      { caption: "/new", text: undefined, photo: [{ file_id: "AgACAgQ" }] },
      { text: "/new", forward_date: 1 },
    ])
      expect(bareCommand(msg(m)), JSON.stringify(m)).toBeNull();
    expect(NEEDS_WORDS("ask")).toBe(
      "Send /ask with your words after it, in one message: /ask <your words>",
    );
  });

  it("turns a chat command into the words a task reads", () => {
    expect(fromCommand("/ask what does spotter do?")).toBe("ask: what does spotter do?");
    expect(fromCommand("/new@shipify_bot a habit tracker")).toBe("new: a habit tracker");
    expect(fromCommand("/remember spotter: uses D1")).toBe("remember: spotter: uses D1");
    // `change` has no fixed first word: its words say the project.
    expect(fromCommand("/change spotter: make it blue")).toBe("spotter: make it blue");
    expect(fromCommand("/notacommand hi")).toBe("/notacommand hi");
    expect(fromCommand("plain words")).toBe("plain words");
    expect(textOf(msg({ text: "/ask hi", forward_date: 1 }))).toBe("(Forwarded) /ask hi");
  });

  it("takes the task from the head of a bot message replied to, or a leading #n of yours", () => {
    expect(
      taskOf(msg({ reply_to_message: { from: BOT, text: "Done · #12 · make it faster\nmore" } })),
    ).toBe(12);
    expect(taskOf(msg({ reply_to_message: { from: BOT, text: "Got it · #7" } }))).toBe(7);
    expect(taskOf(msg({ reply_to_message: { from: BOT, caption: "· #3 · photo.jpg" } }))).toBe(3);
    expect(
      taskOf(msg({ reply_to_message: { from: { is_bot: false }, text: "Done · #12 · x" } })),
    ).toBeNull();
    expect(taskOf(msg({ reply_to_message: { from: BOT, text: "see #12 · later" } }))).toBeNull();
    expect(taskOf(msg({ text: "#81 make it bigger" }))).toBe(81);
    expect(taskOf(msg({ text: "#81 x", forward_date: 1 }))).toBeNull();
    expect(taskOf(msg({ reply_to_message: { from: BOT, text: 5 } }))).toBeNull();
  });

  it("knows words that only thank, and a lone yes or no", () => {
    for (const w of [
      "ok",
      "thanks",
      "Thank   You.",
      "done 🎉",
      "👍🏽",
      "🙏🏻!",
      "cool 👨‍💻",
      "OK...",
    ])
      expect(acknowledgement(w), w).toBe("thanks");
    // A list's Yes too (`yes <code>`): alone, it names no task.
    for (const w of ["yes", "No.", "YES!", "yes 1a2b3c4d"])
      expect(acknowledgement(w), w).toBe("yes-no");
    for (const w of [
      "",
      "yes please",
      "yes 1a2b",
      "ok, ship it",
      "🎉",
      "thanks for #81",
      "ok\nthen add a footer",
    ])
      expect(acknowledgement(w), w).toBeNull();
  });

  it("keeps a message's one file by reference, with its name, type and size", () => {
    expect(
      mediaOf(msg({ photo: [{ file_id: "small" }, { file_id: "AgACbig", file_size: 900 }] })),
    ).toEqual({
      name: "photo.jpg",
      ref: "AgACbig",
      kind: "a photo",
      type: "image/jpeg",
      size: 900,
    });
    expect(
      mediaOf(
        msg({
          document: { file_id: "BQAC", file_name: "notes.pdf", mime_type: "application/pdf" },
        }),
      ),
    ).toMatchObject({ name: "notes.pdf", type: "application/pdf", kind: "a file" });
    expect(mediaOf(msg({ voice: { file_id: "AwAC" } }))).toMatchObject({ kind: "a voice note" });
    expect(mediaOf(msg({ photo: [{ file_id: "bad id!" }] }))).toBeUndefined();
    expect(mediaOf(msg({ photo: "no" }))).toBeUndefined();
  });

  it("titles a task by its first line, a leading `use <model>` left out, 256 at most", () => {
    expect(titleOf("use opus\nwhy is spotter slow?\nmore")).toBe("why is spotter slow?");
    expect(titleOf("  use   opus  \n\n  why?")).toBe("why?");
    expect(titleOf("use opus")).toBe("use opus");
    // A pick of an agent, a model and an effort, a gateway's id among them.
    expect(titleOf("use pi laguna high\nhello")).toBe("hello");
    expect(titleOf("use pi moonshotai/kimi-k3\nhello")).toBe("hello");
    expect(titleOf("use the API to fetch it, then cache it\nmore")).toBe(
      "use the API to fetch it, then cache it",
    );
    expect(pickIn("ask\nuse pi laguna\nuse pi z-ai/glm-5.3 high")).toBe("pi z-ai/glm-5.3 high");
    expect(pickIn("use the API to fetch it")).toBeUndefined();
    expect(titleOf("", { kind: "a photo" })).toBe("a photo");
    expect(titleOf("x".repeat(400))).toHaveLength(256);
    expect(cut("ab😀", 3)).toBe("ab");
  });

  it("checks a link code made from TELEGRAM_SECRET, as ship add telegram makes it", async () => {
    const secret = "tg-secret";
    const now = Date.parse("2026-10-04T12:00:00Z");
    const key = createHmac("sha256", secret).update("shipify:link").digest("hex");
    const mac = (exp: number) =>
      createHmac("sha256", key).update(`telegram|${exp}`).digest("hex").slice(0, 16);
    expect(await linkCode(`2000000000.${mac(2000000000)}`, secret, now, "telegram")).toBe("linked");
    expect(await linkCode(`1000000000.${mac(1000000000)}`, secret, now, "telegram")).toBe(
      "expired",
    );
    expect(await linkCode(`2000000000.${mac(2000000000)}`, "another", now, "telegram")).toBeNull();
    expect(await linkCode(`1000000000.${"0".repeat(16)}`, secret, now, "telegram")).toBeNull();
    expect(await linkCode("", secret, now, "telegram")).toBeNull();
  });
});

const reply = (r: Partial<ReplyLine> = {}): ReplyLine => ({
  v: 1,
  kind: "answer",
  state: "Done",
  title: "make it faster",
  links: [],
  to: ["telegram:5"],
  key: "12:1:abcd1234:think:-",
  ...r,
});

describe("how a reply looks in the chat", () => {
  const on = "https://github.com/o/shipify/issues/12#issuecomment-1";

  it("heads it State · #n · title, so replying carries the task on, its markdown as entities", () => {
    const r = renderReply(
      reply({ brief: "Sonnet · 48 s · 3 tool calls" }),
      12,
      "It's **faster**.",
      on,
    );
    expect(r.text).toBe(
      "Done · #12 · make it faster\n\nIt's faster.\n\nSonnet · 48 s · 3 tool calls",
    );
    // The head bold, its task's number a link to the task; "faster" bold, by offsets into the
    // plain text (no markup to refuse, and no entity inside another).
    expect(r.entities).toEqual([
      { type: "bold", offset: 0, length: "Done".length },
      {
        type: "text_link",
        offset: "Done · ".length,
        length: 3,
        url: "https://github.com/o/shipify/issues/12",
      },
      { type: "bold", offset: "Done · #12 · ".length, length: "make it faster".length },
      { type: "bold", offset: "Done · #12 · make it faster\n\nIt's ".length, length: 6 },
    ]);
    expect(r.keyboard[0]).toEqual([{ text: "On GitHub", url: on }]);
  });

  it("shows a failure's words as the chat shows text: bold, code, links, lists, code blocks", () => {
    const f = chatFormat(
      "**Something went wrong:** it broke\n\n**What to do:** reply `continue`\n\n- see [the run](https://github.com/o/r/actions/runs/1)\n```\nlog line\n```",
    );
    expect(f.text).toBe(
      "Something went wrong: it broke\n\nWhat to do: reply continue\n\n• see the run\nlog line",
    );
    expect(f.entities.map((e) => [e.type, f.text.slice(e.offset, e.offset + e.length)])).toEqual([
      ["bold", "Something went wrong:"],
      ["bold", "What to do:"],
      ["code", "continue"],
      ["text_link", "the run"],
      ["pre", "log line"],
    ]);
    // Only https links become links; anything else stays as its words.
    expect(chatFormat("[x](javascript:alert(1))").entities).toEqual([]);
  });

  it("makes a heading plain words in one bold: Telegram refuses code or a link inside bold", () => {
    const f = chatFormat("## Run `make verify` in [the repo](https://github.com/o/r)\nthen `go`");
    expect(f.text).toBe("Run make verify in the repo\nthen go");
    expect(f.entities.map((e) => [e.type, f.text.slice(e.offset, e.offset + e.length)])).toEqual([
      ["bold", "Run make verify in the repo"],
      ["code", "go"],
    ]);
  });

  it("puts the question last, leaves GitHub's folded details out, and shows titles as text", () => {
    const r = renderReply(
      reply({ title: "Tap /merge_all @bob https://evil.example", question: "Which colour?" }),
      3,
      "Here's what I found.\n\n<details><summary>Run</summary>long</details>",
      on,
    );
    // A question with no quick answers opens the reply box on it, so its links are its last line.
    expect(r.text).toBe(
      "Done · #3 · Tap ∕merge_all ＠bob https:∕∕evil.example\n\nHere's what I found.\n\nWhich colour?\n\nOn GitHub",
    );
    expect(r.forceReply).toBe("Reply to #3…");
  });

  it("shows a list last and whole, its words shortened above it, under only Yes and No (ADR 0049)", () => {
    const lines: string[] = [];
    const call = (i: number) =>
      `${i}. \`notion.create_page\` with \`{"parent":"p","title":"${"t".repeat(70)}"}\``;
    while ([...lines, call(lines.length + 1)].join("\n").length <= LIST_MAX)
      lines.push(call(lines.length + 1));
    const list = `${LIST_HEAD} (tap Yes, or say \`yes\`, within a day):\n${lines.join("\n")}`;
    const words = `${"Here is what I found, at length. ".repeat(200)}\n\n${list}\n\nWant more?`;
    const r = renderReply(
      reply({ kind: "needs-you", state: "Needs you", question: "Shall I?", list: "1a2b3c4d" }),
      12,
      words,
      on,
    );
    expect(r.text.length).toBeLessThanOrEqual(4_096);
    expect(r.text.endsWith(chatFormat(list).text)).toBe(true);
    expect(r.text).toContain("The rest is on GitHub.");
    const [yes, ...rest] = r.keyboard;
    expect(yes).toEqual([
      { text: "Yes", callback_data: "yes 1a2b3c4d" },
      { text: "No", callback_data: "no 1a2b3c4d" },
    ]);
    for (const k of yes ?? [])
      expect(new TextEncoder().encode(k.callback_data).length).toBeLessThanOrEqual(64);
    expect(rest.flat().every((k) => k.url)).toBe(true);
    // One only GitHub takes: its heading alone, which says so, and no Yes or No.
    const g = renderReply(reply({ list: "github" }), 12, `Here.\n\n${list}`, on);
    expect(g.text.endsWith(chatFormat(list.split("\n")[0] ?? "").text)).toBe(true);
    expect(g.keyboard.flat().every((k) => k.url)).toBe(true);
  });

  it("keeps a long reply to its first part, and says the rest is on GitHub", () => {
    expect(shorten("short")).toBe("short");
    const long = `${"first part. ".repeat(100)}\n\n${"rest ".repeat(1000)}`;
    const s = shorten(long);
    expect(s.length).toBeLessThanOrEqual(MAX_SENT);
    expect(s.endsWith("…\n\nThe rest is on GitHub.")).toBe(true);
    expect(s.startsWith("first part.")).toBe(true);
  });

  it("shows only https links as buttons, 8 at most", () => {
    const links = Array.from(
      { length: 10 },
      (_, i) => [`L${i}`, `https://x.y/${i}`] as [string, string],
    );
    const r = renderReply(
      reply({
        links: [
          ["bad", "javascript:alert(1)" as never],
          ["plain", "http://x.y"],
          ...links,
        ] as never,
      }),
      1,
      "",
      on,
    );
    expect(r.keyboard).toHaveLength(8);
    expect(r.keyboard.flat().every((b) => b.url?.startsWith("https://"))).toBe(true);
  });

  it("says what a failed send means: wait, a chat that can't be reached, our message refused, or not confirmed", () => {
    expect(failureOf({ ok: true, status: 200 })).toBe("ok");
    expect(failureOf({ ok: false, status: 429, retryAfter: 3 })).toBe("wait");
    // Only a chat that can't be reached is given up on as such.
    for (const description of [
      "Forbidden: bot was blocked by the user",
      "Forbidden: user is deactivated",
      "Forbidden: bot was kicked from the group chat",
    ])
      expect(failureOf({ ok: false, status: 403, description })).toBe("permanent");
    expect(failureOf({ ok: false, status: 400, description: "Bad Request: chat not found" })).toBe(
      "permanent",
    );
    // Any other 400 is what Shipify made: its bug, never "unblock the bot".
    expect(
      failureOf({ ok: false, status: 400, description: "Bad Request: can't parse entities" }),
    ).toBe("rendering");
    expect(failureOf({ ok: false, status: 400 })).toBe("rendering");
    // No answer (8 seconds), or a 5xx: not confirmed, which the watch's one notice covers.
    expect(failureOf({ ok: false, status: 502 })).toBe("transient");
    expect(failureOf({ ok: false, status: 0 })).toBe("transient");
  });
});

describe("who's who, and the answers in words", () => {
  it("reads people, fails closed, and sends only to a person's own number", () => {
    const people = parsePeople(
      JSON.stringify([
        { name: "owner", on: { github: "o", telegram: "5" } },
        { name: "x", on: { telegram: "@channel" } },
        { on: { telegram: "6" } },
      ]),
    );
    expect(people.map((p) => p.name)).toEqual(["owner", "x"]);
    expect(parsePeople("not json")).toEqual([]);
    expect(parsePeople('{"name":"o"}')).toEqual([]);
    expect(
      chatsIn(["telegram:5", "telegram:6", "telegram:5", "email:5", "telegram:@channel"], people),
    ).toEqual([{ channel: "telegram", chat: "5" }]);
  });

  it("answers /help from intents.json: how to use it, the words, the edits rule and the menu", () => {
    const text = helpText();
    expect(text).toContain(loadIntents().help.guide[0]);
    expect(text).toContain("An edited message isn't read again: send a new one.");
    expect(text).toContain("Words on a task, the same from GitHub or a chat: yes, no, continue");
    expect(text).toContain("Only on GitHub: a PR's merge, and taking an app down");
    expect(text).toContain("/ping:");
    for (const c of CHATS) expect(text).toContain(`/${c.chat}:`);
  });

  it("answers /ping: all good, or what's wrong first, then each box and the watch", () => {
    const now = Date.parse("2026-10-04T12:00:00Z");
    const box = (name: string, status: string) => ({
      name: `${name}-1`,
      status,
      busy: false,
      labels: [{ name: "shipify-box" }, { name: `box-${name}` }],
    });
    const up = toBoxes([box("pi", "online")]);
    expect(pingText(up, new Date(now - 3_600_000).toISOString(), now)).toBe(
      "All good\npi: online, 1 slot (0 busy)\nThe watch: last due run 1h ago",
    );
    const down = toBoxes([box("pi", "offline"), box("vps", "online")]);
    expect(pingText(down, new Date(now - 30 * 3_600_000).toISOString(), now).split("\n")[0]).toBe(
      "pi is offline; the watch hasn't run a due run for 30 h",
    );
    expect(pingText([], null, now)).toContain("No box yet");
  });

  it("answers /apps with each app's health and link", () => {
    expect(
      appsText([
        {
          id: "spotter",
          url: "https://spotter.example.com",
          paused: false,
          health: { ok: true, version: "1.2.0" },
        },
        { id: "links", url: "https://links.example.com", paused: true },
        { id: "play", url: "https://play.example.com", paused: false, health: { ok: false } },
      ]),
    ).toBe(
      "spotter: live · v1.2.0\nhttps://spotter.example.com\n\nlinks: taken down\nhttps://links.example.com\n\nplay: failing\nhttps://play.example.com",
    );
    expect(line("a‮/b @c")).toBe("a∕b ＠c");
  });

  it("answers /notebook with each page, Preferences first, and /recipes with each next time", () => {
    // The owner's zone, as the edge hands it in from its variable (ADR 0047).
    useTimeZone("Asia/Kolkata");
    expect(instantOf("/notebook Preferences")).toEqual({ name: "notebook", rest: "Preferences" });
    expect(instantOf("/recipes@shipify_bot")).toEqual({ name: "recipes", rest: "" });
    expect(instantOf("please /recipes")).toBeNull();
    expect(notebookText([])).toContain("remember:");
    expect(
      notebookText([
        { topic: "Preferences", first: "short answers", lines: 3, url: "https://g/1" },
      ]).split("\n\n")[0],
    ).toBe("Preferences (3 lines): short answers\nhttps://g/1");
    const now = Date.parse("2026-10-05T06:00:00Z");
    expect(
      recipesText(
        [
          {
            name: "daily-brief",
            task: 45,
            every: "every weekday at 08:30",
            next: "2026-10-05T09:00:00Z",
          },
          { name: "site-watch", task: 46, paused: true },
          { name: "weekly", every: "every Monday at 9" },
        ],
        now,
      ),
    ).toBe(
      "daily-brief: every weekday at 08:30 IST, next in 3h · #45\nsite-watch: paused (resume on its task) · #46\nweekly: starting",
    );
    expect(recipesText([], now)).toContain("No recipes yet");
    // A new recipe's next time, from "Coming up", before the next due run writes the list.
    expect(
      recipesText(
        withUpcoming(
          [{ name: "daily-brief", task: 45 }],
          [{ n: 45, next: "2026-10-05T09:00:00Z", every: "every weekday at 08:30" }],
        ),
        now,
      ),
    ).toBe("daily-brief: every weekday at 08:30 IST, next in 3h · #45");
  });

  it("answers /tasks by what each waits on, newest first, a repeat with its next time", () => {
    expect(instantOf("/tasks")).toEqual({ name: "tasks", rest: "" });
    const now = Date.parse("2026-10-05T06:00:00Z");
    expect(groupOf(["needs you", "repeats"])).toBe("needs-you");
    expect(groupOf(["failed"], true)).toBe("needs-you");
    expect(groupOf(["answered"], true)).toBe("working");
    expect(groupOf(["repeats"])).toBe("repeating");
    expect(groupOf([])).toBe("answered");
    const rows = [
      { n: 9, title: "what repeats are live", group: "answered" as const },
      { n: 12, title: "take vitamin D", group: "repeating" as const, next: "2026-10-05T09:00:00Z" },
      { n: 14, title: "a tip calculator", group: "working" as const },
    ];
    expect(tasksText(rows, now)).toBe(
      "Working\n#14 · a tip calculator\n\nRepeating\n#12 · take vitamin D · next in 3h\n\nAnswered\n#9 · what repeats are live",
    );
    expect(tasksText([], now)).toContain("No open tasks");
    const many = Array.from({ length: 11 }, (_, i) => ({
      n: i + 1,
      title: "x",
      group: "answered" as const,
    }));
    expect(tasksText(many, now)).toContain("and 3 more on GitHub");
  });

  it("answers /models with each agent's models from executors.json, and how to pick one", () => {
    expect(instantOf("/models kimi k3")).toEqual({ name: "models", rest: "kimi k3" });
    const all = modelsText();
    expect(all.split("\n\n")[0]).toMatch(
      /^claude \(the default\)\. Auto: sonnet, medium; effort low to max\nhaiku, sonnet, opus, fable$/,
    );
    // A gateway's models by their ids there, one a line, as a use line names them.
    expect(all).toContain(
      "pi, through openrouter. Auto: z-ai/glm-5.3-flash, high; effort off to max\nz-ai/glm-5.3-flash\n",
    );
    expect(all).toContain("\nmoonshotai/kimi-k2.7-code\n");
    expect(all).toContain("Or any model openrouter has: add a word to find them (/models kimi");
    // An agent that offers the same as an earlier one (OpenCode on pi's gateway) is one line.
    const seen = agentsSeen();
    for (const [k, [id, e]] of seen.entries()) {
      const twin = seen.slice(0, k).find(([, x]) => x.gateway === e.gateway && e.gateway);
      if (twin)
        expect(all).toContain(
          `\n\n${id}, through ${e.gateway}: the same Auto, efforts and models as ${twin[0]}.\n\n`,
        );
    }
    // The example is the last agent's last model and effort, which picks it from any task.
    const [last, e] = agentsSeen().at(-1) as [
      string,
      AgentSeen & { models: string[]; efforts: string[] },
    ];
    const model = e.models.findLast((m) => effortsFor(e, m).length);
    const example = `${last} ${model} ${e.efforts.at(-1)}`;
    expect(all.split("\n\n").at(-1)).toContain(`Pick one with a use line, like use ${example}:`);
    expect(pickOf(example, { agent: "claude" })).toMatchObject({ agent: last });
    // Nothing GitHub would take for HTML and drop.
    expect(all).not.toMatch(/</);
    expect(modelsText("kimi", { openrouter: '{"data":[{"id":"a/kimi"}]}' })).not.toMatch(/</);
  });

  it("reads a model's facts from its gateway's list: name, maker, price, size and what it can do", () => {
    const body = JSON.stringify({
      data: [
        {
          id: "z-ai/glm-5.3-flash",
          name: "Z.ai: GLM 5.3 Flash",
          context_length: 1048576,
          pricing: { prompt: "0.00000015", completion: "0.0000005" },
          architecture: { input_modalities: ["text", "image"] },
          top_provider: { max_completion_tokens: 131072 },
          supported_parameters: ["tools", "reasoning", "max_tokens"],
          reasoning: { supported_efforts: ["max", "high", "low", "<b>"] },
        },
        // Thinking it may skip (Nemotron, pi's Auto): `off` too, though its levels don't say it.
        {
          id: "n/thinks-or-not",
          reasoning: { mandatory: false, supported_efforts: ["high", "medium"] },
        },
        // The OpenAI shape alone: an id, nothing else.
        { id: "a/plain-model" },
      ],
    });
    expect(modelsFound("openrouter", body)).toEqual([
      {
        id: "z-ai/glm-5.3-flash",
        name: "GLM 5.3 Flash",
        maker: "Z.ai",
        price: [0.15, 0.5],
        context: 1048576,
        output: 131072,
        can: ["tools", "reasoning", "images"],
        efforts: ["max", "high", "low"],
      },
      { id: "n/thinks-or-not", efforts: ["off", "high", "medium"] },
      { id: "a/plain-model" },
    ]);
  });

  it("reads a list that has its facts elsewhere (Vercel's), keeping language models that use tools with a zero-data-retention provider, and finds by word here", () => {
    const model = (id: string, extra: object = {}) => ({
      id,
      name: id,
      type: "language",
      tags: ["tool-use"],
      zdr: "some",
      ...extra,
    });
    const body = JSON.stringify({
      data: [
        model("moonshotai/kimi-k3", {
          name: "Kimi K3",
          context_window: 1e6,
          max_tokens: 65536,
          pricing: { input: "0.000003", output: "0.000015" },
          tags: ["tool-use", "reasoning", "vision"],
          // What it takes, as the catalog lists it: a toggle has no levels, an effort has them.
          reasoning_options: [
            { type: "toggle" },
            { type: "effort", values: ["none", "low", "high", "max"] },
          ],
        }),
        model("poolside/laguna-s-2.1-free", { pricing: { input: "0", output: "0" } }),
        // No tools, not a language model, or no zero-data-retention provider: never shown.
        model("a/kimi-no-tools", { tags: [] }),
        model("a/kimi-image", { type: "image" }),
        model("a/kimi-kept", { zdr: "none" }),
      ],
    });
    const g = "vercel-ai-gateway";
    expect(modelsFound(g, body, "kimi k3")).toEqual([
      {
        id: "moonshotai/kimi-k3",
        name: "Kimi K3",
        price: [3, 15],
        context: 1e6,
        output: 65536,
        can: ["tools", "reasoning", "images"],
        // The catalog's `none` in the agents' words: `off`.
        efforts: ["off", "low", "high", "max"],
      },
    ]);
    // A model that lists a toggle only takes no effort: its list says so, empty; one with no options at all says nothing.
    expect(modelsFound(g, body, "laguna")?.[0]?.efforts).toBeUndefined();
    const toggle = JSON.stringify({
      data: [model("a/toggle", { reasoning_options: [{ type: "toggle" }] })],
    });
    expect(modelsFound(g, toggle)?.[0]?.efforts).toEqual([]);
    // A word in the id or the name, every word of it; no word: all it has.
    expect(modelsFound(g, body, "LAGUNA free")?.map((m) => m.id)).toEqual([
      "poolside/laguna-s-2.1-free",
    ]);
    expect(modelsFound(g, body)?.map((m) => m.id)).toHaveLength(2);
    expect(modelsFound(g, body, "zzz")).toEqual([]);
    expect(modelsFound(g, "<html>", "kimi")).toBeNull();
    expect(modelsText("kimi", { [g]: body })).toContain(
      "moonshotai/kimi-k3: $3.00 / $15.00, 1M context",
    );
    // A find through another gateway than its agents' first is a button that names its agent there,
    // so a tap runs it on that gateway from any task; OpenRouter's stay the bare id.
    const both = { [g]: body, openrouter: '{"data":[{"id":"moonshotai/kimi-k3"}]}' };
    expect(modelsButtons("kimi", both)).toEqual([
      [{ label: "moonshotai/kimi-k3", words: "use moonshotai/kimi-k3" }],
      [{ label: "moonshotai/kimi-k3", words: "use pi-vercel moonshotai/kimi-k3" }],
    ]);
    expect(pickOf("pi-vercel moonshotai/kimi-k3", { agent: "claude" })).toMatchObject({
      agent: "pi-vercel",
    });
  });

  it("answers /models <word> from a gateway's own list, each id as a use line takes it", () => {
    // The line names each agent on the gateway (pi, and OpenCode beside it).
    const on = agentsSeen()
      .filter(([, e]) => e.gateway === "openrouter")
      .map(([id]) => id);
    const pick = (id: string) =>
      `Pick one with a line: ${on.map((a) => `use ${a} ${id}`).join(" or ")}`;
    expect(modelSearches("")).toEqual([]);
    // OpenRouter searches by itself; a gateway with a `list` path is read whole, then searched here.
    expect(modelSearches(" kimi k3 ")).toEqual([
      {
        gateway: "openrouter",
        url: "https://openrouter.ai/api/v1/models?supported_parameters=tools&limit=20&q=kimi%20k3",
      },
      { gateway: "vercel-ai-gateway", url: "https://ai-gateway.vercel.sh/v1/models" },
    ]);
    // Each gateway answers in its own part: the first is OpenRouter's.
    const part = (text: string) => text.split("\n\n")[0];
    const list = {
      data: [
        {
          id: "moonshotai/kimi-k3",
          pricing: { prompt: "0.00000069", completion: "0.000015" },
          context_length: 1048576,
        },
        // An alias, a command and a broken entry: never shown, as no use line takes them.
        { id: "~moonshotai/kimi-latest" },
        { id: "/ping" },
        { name: "no id" },
        {
          id: "x/kimi-free:free",
          pricing: { prompt: "0", completion: "0" },
          context_length: 262144,
        },
        { id: "y/kimi-plain" },
      ],
    };
    expect(part(modelsText("kimi", { openrouter: JSON.stringify(list) }))).toBe(
      [
        "openrouter, “kimi”: price per million tokens, in / out",
        "moonshotai/kimi-k3: $0.69 / $15.00, 1M context",
        "x/kimi-free:free: free, 262K context",
        "y/kimi-plain",
        pick("moonshotai/kimi-k3"),
      ].join("\n"),
    );
    // A gateway that gives no prices: the ids alone.
    expect(part(modelsText("kimi", { openrouter: '{"data":[{"id":"a/kimi"}]}' }))).toBe(
      `openrouter, “kimi”\na/kimi\n${pick("a/kimi")}`,
    );
    // Its buttons send the id alone: the task's agent takes it when it's one of them, else the first.
    expect(modelsButtons("kimi", { openrouter: '{"data":[{"id":"a/kimi"}]}' })).toEqual([
      [{ label: "a/kimi", words: "use a/kimi" }],
    ]);
    for (const from of [...on, "claude"])
      expect(pickOf("a/kimi", { agent: from })).toMatchObject({
        agent: on.includes(from) ? from : on[0],
        model: "a/kimi",
      });
    const unread = "Couldn't read openrouter's list just now: try again in a minute.";
    expect(part(modelsText("kimi", { openrouter: null }))).toBe(unread);
    expect(part(modelsText("kimi", {}))).toBe(unread);
    expect(part(modelsText("kimi", { openrouter: "<html>" }))).toBe(unread);
    expect(part(modelsText("kimi", { openrouter: " ".repeat(MOST_LIST + 1) }))).toBe(unread);
    expect(part(modelsText("zzz", { openrouter: '{"data":[]}' }))).toBe(
      "openrouter has no model for “zzz” that an agent here takes.",
    );
  });
});
