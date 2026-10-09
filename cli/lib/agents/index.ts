// Every agent adapter, by the name executors.json's `adapter` gives it (ADR 0017,
// docs/plug-ins.md). This is the one place that lists them: a new agent is its adapter file here
// and an entry in executors.json, held to tests/plugins/agent.test.ts. The core imports this list,
// never an adapter.
import type { Adapter } from "../plugins/agent.ts";
import { claude } from "./claude.ts";
import { pi } from "./pi.ts";

export const ADAPTERS: Record<string, Adapter> = { claude, pi };
