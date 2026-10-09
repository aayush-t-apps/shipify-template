// The safe-HTML list (edge/src/web/clean.ts, ADR 0036): what a reply uses is kept as GitHub
// rendered it; anything that could run, or reach anywhere but https, is gone.
import { describe, expect, it } from "vitest";
import { clean, splitDetails, withoutEchoes, withoutPick } from "../../../edge/src/web/clean.ts";

const REPLY = `<p><strong>Done.</strong> See <a href="https://github.com/o/shipify/pull/9" rel="nofollow">#9</a>.</p>
<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled="" checked=""> one</li></ul>
<div class="highlight highlight-source-shell"><pre><span class="pl-c1">pnpm</span> ship add webchat</pre></div>
<table><thead><tr><th align="left">Time</th></tr></thead><tbody><tr><td>5m</td></tr></tbody></table>
<blockquote><p>quoted</p></blockquote><p><g-emoji class="g-emoji" alias="rocket">🚀</g-emoji></p>
<p><a target="_blank" href="https://private-user-images.githubusercontent.com/1/x.png"><img src="https://private-user-images.githubusercontent.com/1/x.png" alt="shot" style="max-width: 100%;"></a></p>
<details><summary>More</summary><p>inside</p></details>`;

describe("clean", () => {
  it("keeps what a reply uses: text, links, task lists, code, tables, quotes, pictures, folds", () => {
    const { html, trimmed } = clean(REPLY);
    expect(trimmed).toBe(false);
    for (const want of [
      "<strong>Done.</strong>",
      'href="https://github.com/o/shipify/pull/9"',
      'rel="noopener noreferrer nofollow"',
      '<input type="checkbox" checked disabled>',
      "<pre><span>pnpm</span> ship add webchat</pre>",
      '<th align="left">Time</th>',
      "<blockquote>",
      "🚀",
      '<img src="https://private-user-images.githubusercontent.com/1/x.png" alt="shot" loading="lazy" referrerpolicy="no-referrer">',
      "<details><summary>More</summary>",
    ])
      expect(html).toContain(want);
    expect(html).not.toContain("class=");
    expect(html).not.toContain("style=");
  });

  it("drops what could run, and says something was left out", () => {
    for (const bad of [
      "<script>alert(1)</script>",
      "<SCRIPT SRC=//x.example></SCRIPT>",
      '<img src="x" onerror="alert(1)">',
      '<img src="javascript:alert(1)">',
      '<a href="javascript:alert(1)">x</a>',
      '<a href="&#106;avascript:alert(1)">x</a>',
      '<a href="java\tscript:alert(1)">x</a>',
      '<a href="data:text/html,<script>alert(1)</script>">x</a>',
      '<iframe src="https://x.example"></iframe>',
      "<svg><script>alert(1)</script></svg>",
      "<style>body{display:none}</style>",
      '<form action="https://x.example"><input name="a"></form>',
      '<div onclick="alert(1)" style="x">x</div>',
      '<input type="text" value="x">',
      '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
    ]) {
      const { html } = clean(bad);
      expect(html, bad).not.toMatch(
        /script|onerror|onclick|iframe|<svg|<style|<form|javascript|data:|style=|<math/i,
      );
    }
    expect(clean("<script>x</script><p>ok</p>")).toEqual({ html: "<p>ok</p>", trimmed: true });
  });

  it("keeps a diagram's source and a heading, without GitHub's own icons, and says nothing's missing", () => {
    const html =
      '<div class="markdown-heading"><h2 class="heading-element">Plan</h2><a class="anchor" href="#plan"><svg class="octicon octicon-link"><path d="M0"></path></svg></a></div>' +
      '<section data-type="mermaid"><div class="js-render-enrichment-target" data-json="{}"><pre lang="mermaid" aria-label="Raw mermaid code">graph TD\nA--&gt;B\n</pre></div><span class="js-render-enrichment-loader"><svg class="octospinner"></svg></span></section>';
    const c = clean(html);
    expect(c.trimmed).toBe(false);
    expect(c.html).toContain("<h2>Plan</h2>");
    expect(c.html).toContain("<pre>graph TD\nA--&gt;B\n</pre>");
    expect(c.html).not.toMatch(/svg|data-json|class=/);
  });

  it("closes what's left open and escapes stray brackets", () => {
    expect(clean("<p><strong>bold").html).toBe("<p><strong>bold</strong></p>");
    expect(clean("1 < 2 > 0").html).toBe("1 &lt; 2 &gt; 0");
    expect(clean("</p>text").html).toBe("text");
  });

  it("http and relative links become https or go", () => {
    expect(clean('<a href="/o/shipify/issues/3">x</a>').html).toContain(
      'href="https://github.com/o/shipify/issues/3"',
    );
    expect(clean('<a href="http://x.example">x</a>').html).toBe(
      '<a rel="noopener noreferrer nofollow" target="_blank">x</a>',
    );
  });
});

describe("splitDetails", () => {
  it("takes a reply's own Run details fold out, to show under its run line", () => {
    const { html, details } = splitDetails(
      "<p>Done.</p><details><summary>Other</summary>o</details>\n<details><summary>Run details: Opus 5.5</summary><table><tr><td>x</td></tr></table></details>",
    );
    expect(html).toBe("<p>Done.</p><details><summary>Other</summary>o</details>\n");
    expect(details).toBe("<table><tr><td>x</td></tr></table>");
    expect(splitDetails("<p>no fold</p>")).toEqual({ html: "<p>no fold</p>" });
  });
});

describe("withoutEchoes", () => {
  it("leaves out what a reply's line shows on its own: its question and its links' list", () => {
    const url = "https://github.com/o/spotter/pull/31?a=1&b=2";
    const { html } = clean(
      `<p>Done.</p>\n<blockquote>\n<p><strong>Question:</strong> Footer too?</p>\n</blockquote>\n<ul>\n<li>PR #31: <a href="${url.replace("&", "&amp;")}" rel="nofollow">${url}</a></li>\n<li>Docs: <a href="https://example.com/d">https://example.com/d</a></li>\n</ul>\n<blockquote><p>A quote of yours</p></blockquote>`,
      "https://github.com/o/shipify/issues/2",
    );
    const out = withoutEchoes(html, { question: "Footer too?", links: [["PR #31", url]] });
    expect(out).not.toContain("Question:");
    expect(out).not.toContain("PR #31");
    // What the line doesn't carry stays: another link, someone's own quote.
    expect(out).toContain("https://example.com/d");
    expect(out).toContain("A quote of yours");
    // Nothing to leave out: as it was. A list left empty goes.
    expect(withoutEchoes(html, { links: [] })).toBe(html);
    expect(
      withoutEchoes('<ul>\n<li>A: <a href="https://x.io/">x</a></li>\n</ul>', {
        links: [["A", "https://x.io/"]],
      }),
    ).toBe("");

    // A link of the reply's in your own words stays, and so does everything after it; GitHub's own
    // "#31" link in the label, and a URL clean() made whole, are still the list's.
    const pr = "https://github.com/o/app/pull/7";
    const mine = clean(
      `<ul><li>Opened <a href="${pr}">o/app#7</a> with the fix</li><li>Then a note</li></ul><h2>Next</h2><p>More words.</p><pre><code>make verify</code></pre><ul><li>PR <a href="https://github.com/o/app/issues/7">#7</a>: <a href="${pr}">${pr}</a></li><li>App: <a href="https://app.a69x.in">https://app.a69x.in</a></li></ul>`,
      "https://github.com/o/shipify/issues/2",
    ).html;
    const kept = withoutEchoes(mine, {
      links: [
        ["PR #7", pr],
        ["App", "https://app.a69x.in"],
      ],
    });
    for (const stays of ["with the fix", "Then a note", "<h2>", "More words.", "make verify"])
      expect(kept).toContain(stays);
    expect(kept).not.toContain("PR <a");
    expect(kept).not.toContain("App:");
  });
});

describe("withoutPick", () => {
  it("leaves your pick's line out of your words (its tag shows it), and only that line", () => {
    expect(withoutPick("<p>use pi moonshotai/kimi-k3<br>\nand the footer too</p>")).toBe(
      "<p>and the footer too</p>",
    );
    expect(withoutPick("<p>use opus</p>")).toBe("");
    // As GitHub sends it: the door's line (a comment) gone, the newline after it left.
    expect(withoutPick('\n<p dir="auto">use pi auto<br>\nhii which is this model ?</p>')).toBe(
      '<p dir="auto">hii which is this model ?</p>',
    );
    expect(withoutPick("<p>make it blue<br>\nuse the brand blue</p>")).toBe(
      "<p>make it blue<br>\nuse the brand blue</p>",
    );
  });
});
