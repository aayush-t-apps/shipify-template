// Where a reply goes (ADR 0031, ADR 0032): chat channels live in the edge (edge/src/channels/, their
// conformance suite tests/edge/channels.test.ts). The core knows only their names: your defaults
// (SHIPIFY_SEND), and which chats a reply goes to.
import { describe, expect, it } from "vitest";
import { replyTo, scheduledReply } from "../cli/kernel/route.ts";
import { defaultChannels } from "../cli/lib/channels.ts";

describe("which channels", () => {
  it("reads your defaults from SHIPIFY_SEND, GitHub always being there", () => {
    expect(defaultChannels("telegram, ntfy github")).toEqual(["telegram", "ntfy"]);
    expect(defaultChannels("")).toEqual([]);
    expect(defaultChannels(undefined)).toEqual([]);
  });

  it("answers the chats that asked; only an alert goes to your default channels too", () => {
    const owner = { name: "owner", on: { telegram: "42" } };
    expect(
      replyTo({ kind: "answer", asked: ["telegram:7"], defaults: ["telegram"], owner }),
    ).toEqual(["telegram:7"]);
    // A task you carry on in GitHub or the web chat stays there, even when it needs you.
    for (const kind of ["needs-you", "live", "failed"] as const)
      expect(replyTo({ kind, asked: [], defaults: ["telegram"], owner })).toEqual([]);
    expect(replyTo({ kind: "alert", asked: [], defaults: ["telegram"], owner })).toEqual([
      "telegram:42",
    ]);
    expect(
      replyTo({ kind: "failed", asked: ["telegram:42"], defaults: ["telegram"], owner }),
    ).toEqual(["telegram:42"]);
    // A task Shipify opened itself (a recipe's): every reply reaches your default channels.
    expect(
      replyTo({ kind: "answer", asked: [], defaults: ["telegram"], owner, ownTask: true }),
    ).toEqual(["telegram:42"]);
    // A repeat's reply (a reminder set with the Repeat form on GitHub, say) reaches them too.
    expect(
      replyTo({ kind: "answer", asked: [], defaults: ["telegram"], owner, scheduled: true }),
    ).toEqual(["telegram:42"]);
    // A repeat made in Telegram answers your default channels, not twice: where it started only when
    // none of them reaches you.
    const both = { name: "owner", on: { telegram: "42", web: "me" } };
    expect(
      replyTo({
        kind: "answer",
        asked: ["telegram:42"],
        defaults: ["web"],
        owner: both,
        scheduled: true,
      }),
    ).toEqual(["web:me"]);
    expect(
      replyTo({
        kind: "answer",
        asked: ["telegram:42"],
        defaults: [],
        owner: both,
        scheduled: true,
      }),
    ).toEqual(["telegram:42"]);
    expect(
      replyTo({
        kind: "answer",
        asked: ["telegram:42"],
        defaults: ["ntfy"],
        owner: both,
        scheduled: true,
      }),
    ).toEqual(["telegram:42"]);
    // `again` typed in a chat runs the repeat's job now: its answer comes where you typed it.
    expect(scheduledReply("think-scheduled", "again-101")).toBe(false);
    expect(scheduledReply("reminder", "2026-10-13T09:00:00.000Z")).toBe(true);
    // No default channel, or no id of yours on it: GitHub only.
    expect(replyTo({ kind: "live", asked: [], defaults: [], owner })).toEqual([]);
    expect(replyTo({ kind: "alert", asked: [], defaults: ["ntfy"], owner })).toEqual([]);
  });
});
