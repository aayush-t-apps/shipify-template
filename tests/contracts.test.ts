import { describe, expect, it } from "vitest";
import {
  agentsSeen,
  asProblem,
  canonicalJson,
  fromLine,
  logger,
  maskSecrets,
  namesPick,
  pickedLine,
  parseUse,
  pickerAsked,
  pickOf,
  pickWords,
  timeZoneNow,
  type Use,
  useTimeZone,
  withZone,
  zoneName,
  pickSaid,
  pickWord,
  problem,
  readFrom,
  readReply,
  renderProblem,
  replyLine,
  useCommand,
  useLine,
  withoutLine,
} from "../cli/contracts/index.ts";

describe("contracts", () => {
  it("writes and reads the door's from line, and only a good one", () => {
    const line = fromLine({ v: 1, person: "owner", channel: "telegram", chat: "42", id: "991" });
    expect(readFrom(`${line}\nhello`)).toEqual({
      v: 1,
      person: "owner",
      channel: "telegram",
      chat: "42",
      id: "991",
    });
    expect(readFrom("<!-- shipify-from {broken} -->")).toBeUndefined();
    expect(readFrom("hello")).toBeUndefined();
    expect(withoutLine(`${line}\nhello`)).toBe("hello");
  });

  it("writes and reads a run's reply line with its key and destinations", () => {
    const line = replyLine({
      v: 1,
      kind: "answer",
      state: "Done",
      title: "t",
      links: [],
      to: ["telegram:42"],
      key: "12:c9:think:x",
    });
    const r = readReply(`${line}\nThe answer.`);
    expect(r?.key).toBe("12:c9:think:x");
    expect(r?.to).toEqual(["telegram:42"]);
  });

  it("makes the same bytes whatever the key order", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });

  it("fills a known problem, masks it, and turns any error into one", () => {
    const p = problem("key-refused", { tool: "notion" });
    expect(p).toMatchObject({ code: "key-refused", fix: "pnpm ship add notion --new --yes" });
    expect(asProblem(new Error("boom ghp_abcdefghijklmnopqrstuvwxyz0123456789\nmore")).what).toBe(
      "Something went wrong: boom [token hidden]",
    );
    expect(renderProblem(p)).toContain("**What to do:**");
  });

  it("logs masked JSON lines and keeps warnings for the run", () => {
    const lines: string[] = [];
    const log = logger(
      { task: 12, step: "plan" },
      (l) => lines.push(l),
      () => new Date(0),
    );
    log.info("run.plan.decided", { profile: "talk" });
    log.warn("run.problem", { message: "token=abcdefghijklmnopqrstuvwxyz" });
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      event: "run.plan.decided",
      task: 12,
      step: "plan",
    });
    expect(lines[1]).toContain("[hidden]");
    expect(log.warnings()).toEqual(["token=[hidden]"]);
  });

  it("masks keys the same way as before", () => {
    expect(
      maskSecrets("x -----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY----- y"),
    ).toBe("x [private key hidden] y");
  });
});

describe("one `use` grammar, the door's and the box's (ADR 0042)", () => {
  const all = Object.fromEntries(agentsSeen());
  const listed = Object.entries(all).flatMap(([agent, e]) =>
    (e.models ?? []).map((model) => ({ agent, model, word: pickWord(model) })),
  );

  it("names each listed model by one word, unique across agents, which picks it from any task", () => {
    const words = listed.map((m) => m.word);
    expect(new Set(words).size).toBe(words.length);
    const taken = new Set([
      ...Object.keys(all),
      "auto",
      ...Object.values(all).flatMap((e) => e.efforts ?? []),
    ]);
    for (const m of listed) {
      expect(taken.has(m.word), m.word).toBe(false);
      for (const from of Object.keys(all))
        expect(
          parseUse(m.word, all, { agent: from }, "claude"),
          `${m.word} from ${from}`,
        ).toMatchObject({
          agent: m.agent,
          model: m.model,
        });
    }
  });

  it("fits every pick a button sends, with each effort its model takes, in Telegram's 64 bytes", () => {
    for (const m of listed) {
      const e = all[m.agent];
      const efforts = e?.noEffort?.includes(m.model) ? [] : (e?.efforts ?? []);
      for (const words of [`use ${m.word}`, ...efforts.map((x) => `use ${m.word} ${x}`)]) {
        expect(new TextEncoder().encode(words).length, words).toBeLessThanOrEqual(64);
        expect(
          parseUse(useCommand(words) ?? "", all, { agent: "claude" }, "claude"),
          words,
        ).toBeDefined();
      }
    }
  });

  it("a model names its agent: `use sonnet` on a pi task, `use glm-5.3-flash` on a Claude one (#233)", () => {
    const onPi = { agent: "pi", model: "z-ai/glm-5.3" };
    expect(parseUse("sonnet", all, onPi, "claude")).toMatchObject({
      agent: "claude",
      model: "sonnet",
      effort: undefined,
      label: "Sonnet",
    });
    expect(
      parseUse("glm-5.3-flash high", all, { agent: "claude", model: "opus" }, "claude"),
    ).toEqual({
      agent: "pi",
      model: "z-ai/glm-5.3-flash",
      effort: "high",
      label: "Pi · glm-5.3-flash · High",
    });
    // Naming the agent still works, as do an effort alone and auto.
    expect(parseUse("pi z-ai/glm-5.3 high", all, { agent: "claude" }, "claude")?.model).toBe(
      "z-ai/glm-5.3",
    );
    expect(parseUse("max", all, { agent: "claude", model: "opus" }, "claude")?.label).toBe(
      "Opus · Max",
    );
    expect(parseUse("auto", all, { agent: "claude", model: "opus" }, "claude")?.label).toBe("Auto");
    // Refused: an effort its model doesn't take, another agent's model with an agent named, two models.
    expect(parseUse("haiku max", all, { agent: "claude" }, "claude")).toBeUndefined();
    expect(parseUse("claude glm-5.3-flash", all, { agent: "claude" }, "claude")).toBeUndefined();
    expect(parseUse("opus sonnet", all, { agent: "claude" }, "claude")).toBeUndefined();
    // A word two listed models share after their maker names neither.
    const two = { a: { models: ["x/same"] }, b: { models: ["y/same"] } };
    expect(parseUse("same", two, { agent: "a" }, "a")).toBeUndefined();
  });

  it("the door reads a pick as the box does, and knows words that try one from words that don't", () => {
    expect(pickSaid("sonnet")).toBe("Sonnet");
    expect(pickSaid("glm-5.3-flash")).toBe("Pi · glm-5.3-flash");
    expect(pickSaid("pi z-ai/glm-5.3 high")).toBe("Pi · glm-5.3 · High");
    expect(pickSaid("banana")).toBeUndefined();
    // An effort alone is the task's agent's: pi's `off` on a pi task, never on Claude's.
    expect(pickSaid("off")).toBeUndefined();
    expect(pickSaid("off", { agent: "pi" })).toBe("Pi · Off");
    expect(namesPick("pi opus", all)).toBe(true);
    expect(namesPick("haiku max", all)).toBe(true);
    // An effort alone tries a pick too, whichever agent takes it: on pi, `use max` is told.
    expect(namesPick("max", all)).toBe(true);
    expect(namesPick("tailwind", all)).toBe(false);
    // Words that only start like a pick are words: every word must be a pick's, three at most.
    expect(namesPick("haiku form", all)).toBe(false);
    expect(namesPick("pi to estimate the area", all)).toBe(false);
    expect(useLine("which css?\nuse tailwind for it.")).toBe("tailwind for it");
    // The door and the box choose a message's pick line the same way: a word for the agent
    // ("use tailwind") never hides the pick before it.
    expect(
      pickedLine("a landing page\nuse opus\nuse tailwind", all, { agent: "claude" }, "claude"),
    ).toBe("opus");
    expect(
      pickedLine("which css?\nuse tailwind", all, { agent: "claude" }, "claude"),
    ).toBeUndefined();
    expect(pickedLine("fix it\nuse haiku max", all, { agent: "claude" }, "claude")).toBe(
      "haiku max",
    );
    expect(useLine("use the logo's blue, as before")).toBeUndefined();
  });

  it("`/use <words>` is `use <words>`; `/use` alone asks for the picker", () => {
    expect(useCommand("/use opus")).toBe("opus");
    expect(useCommand("/use@shipify_bot sonnet high")).toBe("sonnet high");
    expect(useCommand("/use")).toBeUndefined();
    for (const t of ["/use", " /use@shipify_bot ", "/USE"]) expect(pickerAsked(t), t).toBe(true);
    for (const t of ["/use opus", "use", "/user"]) expect(pickerAsked(t), t).toBe(false);
  });

  it("every listed model and effort picks itself from its word, and its whole words read back the same", () => {
    for (const [agent, e] of agentsSeen())
      for (const model of e.models ?? [])
        for (const effort of [
          undefined,
          ...(e.noEffort?.includes(model) ? [] : (e.efforts ?? [])),
        ]) {
          const words = [pickWord(model), effort].filter(Boolean).join(" ");
          const u = pickOf(words);
          expect(u, words).toMatchObject({ agent, model, ...(effort ? { effort } : {}) });
          // Kept as your model, its whole words mean it from any pick (model.ts).
          const back = pickOf(pickWords(u as Use), { agent: "pi" });
          expect(back, words).toMatchObject({ agent, model, ...(effort ? { effort } : {}) });
        }
    // An id only a gateway's pattern takes keeps its maker, and reads back too.
    const own = pickOf("pi moonshotai/kimi-k3 high");
    expect(own?.label).toBe("Pi · moonshotai/kimi-k3 · High");
    expect(pickOf(pickWords(own as Use), { agent: "claude", model: "opus" })).toMatchObject({
      agent: "pi",
      model: "moonshotai/kimi-k3",
      effort: "high",
    });
    // An agent's Auto is its own `auto`, from any pick.
    expect(pickWords({ agent: "pi" })).toBe("pi auto");
    expect(pickOf("pi auto", { agent: "claude", model: "opus", effort: "max" })).toMatchObject({
      agent: "pi",
    });
    expect(pickOf("pi auto", { agent: "claude", model: "opus" })?.model).toBeUndefined();
  });
});

describe("the owner's time zone, said everywhere a repeat's time is", () => {
  it("is your copy's SHIPIFY_TIME_ZONE as it's handed in (UTC before, or for a name that isn't one), named short, and added to a schedule that has a time of day", () => {
    expect(timeZoneNow()).toBe("UTC");
    useTimeZone("Not/AZone");
    expect(timeZoneNow()).toBe("UTC");
    useTimeZone("Asia/Kolkata");
    expect(timeZoneNow()).toBe("Asia/Kolkata");
    expect(zoneName("2026-10-11T08:30:00Z")).toBe("IST");
    expect(withZone("every Sunday at 14:00")).toBe("every Sunday at 14:00 IST");
    expect(withZone("every 2 hours from 09:00 to 21:00")).toBe(
      "every 2 hours from 09:00 to 21:00 IST",
    );
    expect(withZone("every hour")).toBe("every hour");
    expect(withZone("every Sunday at 14:00 IST")).toBe("every Sunday at 14:00 IST");
    useTimeZone(undefined);
  });
});
