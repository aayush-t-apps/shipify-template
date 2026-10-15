// The people in this Shipify (ADR 0030 §2): SHIPIFY_PEOPLE, read safely. It holds each person's
// name and ids (`on`); your default channels stay in SHIPIFY_SEND.
import { describe, expect, it } from "vitest";
import { ownerOnly, readPeople, withId } from "../cli/lib/people.ts";

describe("SHIPIFY_PEOPLE", () => {
  it("unset, it's you, from SHIPIFY_OWNER: as before", () => {
    expect(readPeople("", "aayush")).toEqual({
      people: [{ name: "aayush", on: { github: "aayush" } }],
    });
    expect(ownerOnly(undefined)).toEqual([{ name: "you", on: {} }]);
  });

  it("a value that doesn't fit admits no one more than before, and says why", () => {
    for (const raw of ["{", "[]", '[{"name":"x"}]', '[{"name":"x","on":{"Bad Name":"1"}}]']) {
      const r = readPeople(raw, "aayush");
      expect(r.people, raw).toEqual(ownerOnly("aayush"));
      expect(r.broken, raw).toMatch(/SHIPIFY_PEOPLE/);
    }
  });

  it("sets a person's id on a channel, and only that", () => {
    const people = readPeople('[{"name":"Aayush","on":{"github":"aayush"}}]').people;
    const next = withId(people, "telegram", "123");
    expect(next).toEqual([{ name: "Aayush", on: { github: "aayush", telegram: "123" } }]);
    expect(() => withId(people, "Not A Channel", "1")).toThrow(/isn't a channel/);
    expect(() => withId(people, "telegram", "1", "Someone")).toThrow(/No one here/);
  });
});
