#!/usr/bin/env node
// Shipify's CLI as one plain `node` command, wherever it runs (a box's read-only copy, a checkout):
// no package manager, so it starts under any HOME, and the agent's allowed commands (`node …`) take
// it. The same as `pnpm ship`.
import { register } from "tsx/esm/api";

register();
await import("./cli.ts");
