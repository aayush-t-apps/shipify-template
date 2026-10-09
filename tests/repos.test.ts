// Naming repos (ADR 0044): one function from a task's name to `owner/name`, and URLs read whole,
// dots and all.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lookedUp } from "../cli/kernel/snapshot.ts";
import { repoOf } from "../cli/lib/github.ts";
import { type RepoRef, repoFor } from "../cli/lib/projects-on-github.ts";
import { inertImages, looksAt } from "../cli/lib/task.ts";

describe("repoOf: owner/name from a GitHub URL", () => {
  it("keeps a name with dots, and drops .git and anything after the name", () => {
    expect(repoOf("https://github.com/acme/my.tool")).toBe("acme/my.tool");
    expect(repoOf("https://github.com/acme/my.tool.git")).toBe("acme/my.tool");
    expect(repoOf("git@github.com:acme/tool.git")).toBe("acme/tool");
    expect(repoOf("https://github.com/acme/tool/pull/3")).toBe("acme/tool");
    expect(repoOf("https://github.com/acme/tool#readme")).toBe("acme/tool");
  });

  it("refuses what isn't a repo's URL", () => {
    expect(() => repoOf("https://example.com/acme/tool")).toThrow();
    expect(() => repoOf("https://github.com/acme")).toThrow();
  });
});

describe("looksAt: the repos a task's words name with `look at`", () => {
  it("reads owner/name, a github.com link and a plain name, in order, each once", () => {
    expect(looksAt("look at acme/tool and tell me what it does")).toEqual(["acme/tool", "tell"]);
    // After a comma, the next word is read as a name too: the repos list says it's none.
    expect(looksAt("Look at https://github.com/acme/my.tool/tree/main/src, please")).toEqual([
      "acme/my.tool",
      "please",
    ]);
    expect(looksAt("look at spotter, links and acme/x: compare them")).toEqual([
      "spotter",
      "links",
      "acme/x",
    ]);
    expect(looksAt("look at acme/x. Then look at acme/x again")).toEqual(["acme/x"]);
  });

  it("takes nothing without the words, and nothing that isn't a repo's name", () => {
    expect(looksAt("what does acme/tool do?")).toEqual([]);
    expect(looksAt("look at ../etc/passwd")).toEqual([]);
    expect(looksAt("look at a/..")).toEqual([]);
    expect(looksAt("look at a;b/c")).toEqual([]);
    expect(looksAt("I'll look at it later")).toEqual(["it"]);
  });
});

describe("repoFor: the repo a task's name stands for", () => {
  const repos: RepoRef[] = [
    { name: "spotter", repo: "o/spotter", sizeKB: 1, project: true, branch: "main" },
    { name: "My.Notes", repo: "o/My.Notes", sizeKB: 1, project: false, branch: "main" },
    // A project whose id isn't its repo's name.
    { name: "links", repo: "o/link-shortener", sizeKB: 1, project: true, branch: "main" },
  ];

  it("is the repo the installation lists under that name", () => {
    expect(repoFor("links", repos)).toBe("o/link-shortener");
    expect(repoFor("My.Notes", repos)).toBe("o/My.Notes");
  });

  it("prefers a project when a repo has the same name", () => {
    expect(
      repoFor("spotter", [
        { name: "spotter", repo: "o/spotter-old", sizeKB: 1, project: false, branch: "main" },
        ...repos,
      ]),
    ).toBe("o/spotter");
  });

  it("is a project's own repo (the owner, the prefix, the id) when GitHub doesn't list it yet", () => {
    expect(repoFor("fresh", repos)).toMatch(/^[^/]+\/fresh$/);
  });

  it("is an owner/name as itself, on any account (ADR 0045), never prefixed", () => {
    expect(repoFor("Acme/api", repos)).toBe("Acme/api");
    expect(
      repoFor("Acme/api", [
        ...repos,
        { name: "Acme/api", repo: "Acme/api", sizeKB: 1, project: false, branch: "develop" },
      ]),
    ).toBe("Acme/api");
  });
});

describe("inertImages: no image of a reply that read outside content fetches anything (ADR 0044)", () => {
  it("escapes every markdown image's bang, inline or by reference, titled or bracketed", () => {
    for (const img of [
      "![chart](https://x.example/c.png?d=1)",
      '![a](https://x.example/a.png "t")',
      "![a](https://x.example/a.png 't')",
      "![a](<https://x.example/a b.png>)",
      "![ref]",
      "![alt][ref]",
      "[![badge](https://x.example/b.svg)](https://ok)",
    ])
      expect(inertImages(img), img).not.toMatch(/(^|[^\\])!\[/);
    expect(inertImages("![x](u)")).toBe("\\![x](u)");
    // Already escaped: left as it is, and an escaped backslash can't bring the image back.
    expect(inertImages("\\![x](u)")).toBe("\\![x](u)");
    expect(inertImages("\\\\![x](u)")).toBe("\\\\\\![x](u)");
  });

  it("shows a tag that fetches as text, and leaves plain links and plain words alone", () => {
    const tags =
      '<img src="https://x/p.png"> <IMG SRC=x> <img/src=x> <picture><source srcset="https://x/s.png"></picture> <video src=x>';
    expect(inertImages(tags)).not.toMatch(/<(img|picture|source|video)/i);
    for (const plain of ["[a link](https://ok) and <https://ok>", "a | table | and &amp;"])
      expect(inertImages(plain)).toBe(plain);
    // A `!` before `[` is escaped wherever it is: GitHub shows `Done\![1]` as "Done![1]".
    expect(inertImages("Done![1]")).toBe("Done\\![1]");
  });

  it("is inert in code too: no guess at where GitHub's code ends lets an image through", () => {
    // Each of these fooled a guess at fences, and GitHub rendered the image (the second review).
    for (const tricky of [
      "    ```\n![x](https://x/a.png)",
      "```x`\n![x](https://x/a.png)\n```",
      "```\n![x](https://x/a.png)\n````",
      "~~~\n```\n~~~\n![x](https://x/a.png)",
      "<div>\n```\n<img src=https://x/a.png>\n```\n</div>",
      "- item\n  ```\nnot indented\n![x](https://x/a.png)\n  ```",
    ])
      expect(inertImages(tricky), tricky).not.toMatch(/(^|[^\\])!\[|<img/);
  });
});

describe("lookedUp: what GitHub says of each repo a task looks at that isn't yours (ADR 0044)", () => {
  it("asks once per owner/name: a public repo with its size, else the status it answered", () => {
    const bin = mkdtempSync(join(tmpdir(), "gh-"));
    const calls = join(bin, "calls");
    // A stand-in gh: `gh api repos/<o>/<n> --jq …`, as GitHub would answer each.
    writeFileSync(
      join(bin, "gh"),
      `#!/bin/sh
echo "$2" >> "${calls}"
case "$2" in
  repos/acme/tool) printf 'acme/Tool\\t42\\tfalse\\n' ;;
  repos/acme/secret) printf 'acme/secret\\t1\\ttrue\\n' ;;
  repos/acme/busy) echo "gh: API rate limit exceeded (HTTP 429)" >&2; exit 1 ;;
  *) echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;
esac
`,
      { mode: 0o755 },
    );
    const was = process.env.PATH;
    process.env.PATH = `${bin}:${was}`;
    try {
      const looked = lookedUp(
        {
          issue: {
            title: "ask: look at acme/tool, acme/secret, acme/busy and src/App.tsx",
            body: "and look at acme/tool again, and o/spotter",
          } as never,
          said: [],
          repos: [{ name: "spotter", repo: "o/spotter", sizeKB: 1, project: true, branch: "main" }],
        },
        "ghs_read",
      );
      expect(looked).toEqual({
        "acme/tool": { repo: "acme/Tool", sizeKB: 42 },
        "acme/secret": { status: 404 },
        "acme/busy": { status: 429 },
        "src/app.tsx": { status: 404 },
      });
      // Once each, and never for your own.
      expect(readFileSync(calls, "utf8").trim().split("\n").sort()).toEqual(
        ["repos/acme/busy", "repos/acme/secret", "repos/acme/tool", "repos/src/App.tsx"].sort(),
      );
    } finally {
      process.env.PATH = was;
    }
  });
});
