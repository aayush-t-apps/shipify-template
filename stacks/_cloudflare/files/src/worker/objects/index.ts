// #if OPTION_DO
// App-owned: every Durable Object class, and only those. src/worker/index.ts gives these names to
// the runtime, so each one is also in wrangler.jsonc's `exports` (AGENTS.md, "Storage").
export { Counter } from "./counter";
// #endif
