#!/usr/bin/env node
// A stand-in for gitleaks (`gitleaks dir <tree> … --report-path <file>`), every test's by default
// (tests/env.ts sets SHIPIFY_GITLEAKS to it): a test never downloads the real one, which takes 30 s
// to start on a Raspberry Pi. It flags each line with the word LEAK in it (not GITLEAKS, a
// pipeline's), as gitleaks would a key, and
// lists every file it was shown in FAKE_GITLEAKS_SEEN and its arguments in FAKE_GITLEAKS_ARGS,
// when set. tests/secret-scan.test.ts runs the real one once.
import { appendFileSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const a = process.argv.slice(2);
if (process.env.FAKE_GITLEAKS_ARGS)
  writeFileSync(process.env.FAKE_GITLEAKS_ARGS, JSON.stringify(a));
const root = a[1];
const found = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else {
      if (process.env.FAKE_GITLEAKS_SEEN)
        appendFileSync(process.env.FAKE_GITLEAKS_SEEN, `${p.slice(root.length + 1)}\n`);
      readFileSync(p, "utf8")
        .split("\n")
        .forEach((l, i) => {
          if (/\bLEAK\b/.test(l))
            found.push({ File: p, StartLine: i + 1, RuleID: "generic-api-key" });
        });
    }
  }
};
walk(root);
writeFileSync(a[a.indexOf("--report-path") + 1], JSON.stringify(found));
process.exit(found.length ? 1 : 0);
