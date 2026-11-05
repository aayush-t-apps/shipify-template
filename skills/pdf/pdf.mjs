#!/usr/bin/env node
// The pdf skill's one command: a page you wrote (HTML) printed to a PDF by headless Chromium, the
// test browser Playwright keeps in ~/.cache/ms-playwright. With none there, it installs one first
// (once a slot; a guest's run has caches of its own, so once a run). Node's own modules only.
//
//   node pdf.mjs <page.html> [<out.pdf>]
//
// It prints the PDF's path, size and pages, or says what failed and exits 1.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The Playwright that installs the browser: the version Shipify's stacks pin. */
const PLAYWRIGHT = "1.64.0";
const SHELL = "chromium_headless_shell-";

const fail = (why) => {
  console.error(`pdf: ${why}`);
  process.exit(1);
};

/** The newest headless shell Playwright installed, or undefined. */
export function browser(
  roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), ".cache/ms-playwright")],
) {
  for (const root of roots.filter(Boolean)) {
    if (!existsSync(root)) continue;
    const builds = readdirSync(root)
      .filter((d) => d.startsWith(SHELL))
      .sort((a, b) => Number(b.slice(SHELL.length)) - Number(a.slice(SHELL.length)));
    for (const b of builds)
      for (const d of readdirSync(join(root, b)).filter((x) => x.startsWith("chrome-"))) {
        const bin = join(root, b, d, "chrome-headless-shell");
        if (existsSync(bin)) return bin;
      }
  }
  return undefined;
}

/** How many pages a PDF has, by its page objects. */
export const pages = (pdf) => pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0;

function main([page, to]) {
  if (!page) fail("usage: node pdf.mjs <page.html> [<out.pdf>]");
  const from = resolve(page);
  if (!existsSync(from)) fail(`${page} isn't there.`);
  if (!/\.html?$/i.test(from)) fail(`${page} isn't a web page: write the PDF as HTML first.`);
  const out = resolve(to ?? from.replace(/\.html?$/i, ".pdf"));
  // Printed beside it first: a PDF already there stays until the new one is whole.
  const part = `${out}.part`;
  let bin = browser();
  if (!bin) {
    console.error("pdf: no browser yet; installing Chromium's headless shell (once)…");
    const r = spawnSync(
      "npx",
      ["-y", `playwright@${PLAYWRIGHT}`, "install", "--only-shell", "chromium"],
      { stdio: ["ignore", 2, 2], timeout: 10 * 60_000 },
    );
    bin = r.status === 0 ? browser() : undefined;
    if (!bin) fail("couldn't install the browser (no network, or no room): say so in your reply.");
  }
  // Its own sandbox needs user namespaces, which the box's agents don't have: the run is the
  // sandbox, and the page is your own.
  const r = spawnSync(
    bin,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--no-pdf-header-footer",
      "--virtual-time-budget=10000",
      `--print-to-pdf=${part}`,
      pathToFileURL(from).href,
    ],
    { stdio: ["ignore", "ignore", "pipe"], timeout: 2 * 60_000 },
  );
  const made = existsSync(part) && readFileSync(part);
  if (r.status !== 0 || !made || !made.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    rmSync(part, { force: true });
    const why = String(r.stderr ?? r.error ?? "").trim().split("\n").pop();
    fail(`Chromium made no PDF: ${why}`);
  }
  renameSync(part, out);
  const kb = Math.max(1, Math.round(statSync(out).size / 1000));
  console.log(`${out}: ${kb} KB, ${pages(made)} page(s)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2));
