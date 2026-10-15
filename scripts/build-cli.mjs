#!/usr/bin/env node
// The CLI built as one file (ADR 0051 B1): esbuild bundles cli/cli.ts — its packages inside, Node's
// own modules outside — into cli/dist/ship.mjs (git-ignored). A box starts every step and the
// agent's own `ship` commands from it (task.yml, cli/kernel/think.ts): one start costs 0.66 s
// against the source's 2.65 s. Your PC, CI and the tests keep the source through tsx, so an edit
// needs no build. `--out` and `--metafile` serve the box's copy step and the bundle test.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { parseArgs } from "node:util";
import { build } from "esbuild";

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    metafile: { type: "string" },
  },
});
const out = values.out ?? "cli/dist/ship.mjs";
mkdirSync(dirname(out), { recursive: true });
const result = await build({
  entryPoints: ["cli/cli.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  outfile: out,
  metafile: true,
  // A bundled CommonJS package needs its `require`; everything else stays as it is written.
  banner: {
    js: 'import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);',
  },
});
if (values.metafile) writeFileSync(values.metafile, JSON.stringify(result.metafile));
const [name, { bytes }] = Object.entries(result.metafile.outputs)[0] ?? [["?", { bytes: 0 }]];
process.stdout.write(
  `built ${relative(process.cwd(), out)} from ${name} (${Math.round(bytes / 1024)} kB)\n`,
);
