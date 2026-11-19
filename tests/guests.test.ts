// Whose an issue is (ADR 0071, cli/contracts/guests.ts `whose`): the one check the edge and the box
// share, from the issue's marks and its writer as the reader proved it. And a project read on the
// box takes its guest from the same check (cli/kernel/projects.ts).
import { describe, expect, it } from "vitest";
import { guestLabel, whose } from "../cli/contracts/index.ts";
import { placed } from "../cli/kernel/projects.ts";

const ANA = "guest-ana-3f9a2c";
const BEN = "guest-ben-0b1c2d";
const marked = (id: string) => ["guest", guestLabel(id)];

describe("whose an issue is (task #784)", () => {
  it("what the door wrote is whose its opening line says: its labels don't count", () => {
    expect(whose({ by: "door", from: ANA, labels: marked(BEN) })).toBe(ANA);
    expect(whose({ by: "door", labels: marked(BEN) })).toBeUndefined();
  });

  it("a doc a run wrote is whose label it carries; anyone else's issue is yours", () => {
    expect(
      whose({ by: "run", from: BEN, labels: [{ name: "guest" }, { name: guestLabel(ANA) }] }),
    ).toBe(ANA);
    expect(whose({ by: "run", labels: [] })).toBeUndefined();
    expect(whose({ by: "other", from: ANA, labels: marked(ANA) })).toBeUndefined();
  });

  it("an item of a list, its writer unproven, is whose label it carries", () => {
    expect(whose({ labels: marked(ANA) })).toBe(ANA);
    // Marked a guest's with no id of theirs: no guest's to open, and none of yours.
    for (const labels of [["guest"], ["guest", "guest:someone"]]) {
      expect(whose({ labels })).toBe("guest");
      expect(whose({ labels })).not.toBe(ANA);
    }
    expect(whose({ labels: ["guest:someone"] })).toBeUndefined();
    expect(whose({ labels: ["project"] })).toBeUndefined();
    expect(whose({})).toBeUndefined();
  });

  it("a project the box reads is its guest's by its label, not its name", () => {
    const project = (labels: string[]) =>
      placed(
        { number: 40, title: "Project: g3f9a2c-health", body: "", state: "open", labels },
        undefined,
      ).project;
    expect(project(["project", ...marked(ANA)])?.guest).toBe(ANA);
    expect(project(["project"])).not.toHaveProperty("guest");
  });
});
