// The people in this Shipify (ADR 0030 §2): today, you. Each person has a name and an id on each
// channel (`on`, GitHub included). They live in one repo variable, SHIPIFY_PEOPLE, which `ship
// people` (and a channel's setup, for your id there) writes. Unset or unreadable, it's you, from
// SHIPIFY_OWNER, as before. Your default channels stay SHIPIFY_SEND's. Who may do what doesn't
// change here: you may.
import { z } from "zod";

const word = /^[a-z][a-z0-9-]*$/;

export const Person = z.object({
  name: z.string().min(1).max(60),
  /** Their id on each channel: `{ github: "login", telegram: "123456789" }`. */
  on: z.record(z.string().regex(word), z.string().min(1).max(100)),
});
export type Person = z.infer<typeof Person>;

export const People = z.array(Person).min(1).max(20);

/** You, as SHIPIFY_OWNER says: who's here when SHIPIFY_PEOPLE isn't set. */
export function ownerOnly(owner?: string): Person[] {
  return [{ name: owner || "you", on: owner ? { github: owner } : {} }];
}

/**
 * SHIPIFY_PEOPLE, read safely: a value that doesn't fit gives you alone (from SHIPIFY_OWNER), and
 * says why, so nothing that reads it ever admits more than before.
 */
export function readPeople(
  raw = process.env.SHIPIFY_PEOPLE,
  owner = process.env.SHIPIFY_OWNER,
): { people: Person[]; broken?: string } {
  if (!raw?.trim()) return { people: ownerOnly(owner) };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { people: ownerOnly(owner), broken: "SHIPIFY_PEOPLE isn't JSON" };
  }
  const parsed = People.safeParse(value);
  if (!parsed.success)
    return {
      people: ownerOnly(owner),
      broken: `SHIPIFY_PEOPLE doesn't fit: ${parsed.error.issues
        .slice(0, 2)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    };
  return { people: parsed.data };
}

/** A person's id on a channel set (the first person by default: you), the rest as they were. */
export function withId(people: Person[], channel: string, id: string, name?: string): Person[] {
  if (!word.test(channel)) throw new Error(`"${channel}" isn't a channel's name`);
  const at = name ? people.findIndex((p) => p.name === name) : 0;
  if (at < 0) throw new Error(`No one here is called "${name}"`);
  return People.parse(
    people.map((p, i) => (i === at ? { ...p, on: { ...p.on, [channel]: id } } : p)),
  );
}
