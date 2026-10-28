// @ts-check
// Shipify chat: a split task's Plan card (ADR 0066), loaded the first time a task with parts opens.
// Its parts in order under the thread's header, each with its state, project, PR and what it waits
// for. It keeps nothing: the plan comes with the thread (one read at the edge, kept 60 s).
import { h, icon } from "./compose.js";

/** What the page lends it (app.js `lazy`): its state and a few of its helpers. @type {any} */
let A;
const WORD = {
  "needs-you": "Needs you",
  working: "Working",
  stuck: "Stopped",
  waiting: "Waiting",
  open: "Open",
  closed: "Closed",
};

/** Takes what the page lends, and loads its stylesheet; ready once it has. */
export function init(a) {
  A = a;
  return new Promise((r) =>
    document.head.append(h("link", { rel: "stylesheet", href: "plan.css", onload: r, onerror: r })),
  );
}

/**
 * The card, under the thread's header: Start sends `go #n` on a ready part, Start all ready `go`,
 * Stop `stop`, your words as a reply's buttons send them; Open all as tabs puts the open parts in
 * their projects' tabs (ADR 0065). Open on a PC, folded on a phone; drawn again only when it changed.
 */
export function plan(v, t) {
  const T = t.task;
  const k = JSON.stringify([T.plan, T.started, T.open, t.writable]);
  if (v.pk === k) return;
  v.pk = k;
  const was = v.box.querySelector(".plan");
  const can = T.open && t.writable;
  const send = (w) => (e) => {
    e.currentTarget.disabled = true;
    A.say(T.n, w);
  };
  // Shipify's own PRs open here, to review; others on GitHub.
  const pr = (p) =>
    p.url.startsWith(T.url.replace(/issues\/\d+$/, "pull/"))
      ? h("a.chip", { href: `#/t/${p.n}` }, `PR #${p.n}`)
      : A.ext(p.url, `PR #${p.n}`, ".chip");
  const part = (x) => {
    const P = A.projOf(x);
    const st = x.dropped ? "Dropped" : WORD[x.state];
    const after = x.after && `waits for ${x.after.map((n) => `#${n}`).join(", ")}`;
    return h(
      `li${x.ready ? ".ready" : ""}`,
      h(`i.mark.${x.state}`, { title: st }),
      h("span.pt", A.to(x.n, A.bare(x.title)), A.meta(`#${x.n}`, P && A.named(P), st, after)),
      x.pr && pr(x.pr),
      can && x.ready && A.btn("Start", send(`go #${x.n}`), ".btn.answer"),
    );
  };
  const l = T.plan;
  const closed = l.filter((x) => x.state === "closed").length;
  const fill = h("i");
  fill.style.width = `${(100 * closed) / (l.length || 1)}%`;
  const open = l.filter((x) => x.state !== "closed");
  const tabs = (e) => {
    const b = e.currentTarget;
    A.ws((w) => w.tab(open));
    b.disabled = true;
    b.lastChild.textContent = "Opened as tabs";
  };
  const stop = (e) => confirm("Start no more parts? The ones that run finish.") && send("stop")(e);
  const acts = h(
    "p.links",
    can && l.some((x) => x.ready) && A.btn("Start all ready", send("go"), ".btn.answer"),
    can && T.started && A.btn("Stop", stop, ".btn"),
    open.length > 0 && A.btn([icon("app"), h("span", "Open all as tabs")], tabs, ".btn"),
  );
  const d = h(
    "details.plan",
    { open: was ? was.open : matchMedia("(min-width: 800px)").matches },
    h(
      "summary",
      icon("down"),
      "Plan",
      h("span.bar", fill),
      h("small", `${closed}/${l.length} closed`),
    ),
    acts,
    h("ol", l.map(part)),
  );
  if (was) was.replaceWith(d);
  else v.head.after(d);
}
