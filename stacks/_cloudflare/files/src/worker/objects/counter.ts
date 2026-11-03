// #if OPTION_DO
// App-owned: the starter Durable Object (AGENTS.md, "Storage"). Rename or replace it before the
// first deploy: once a class has shipped, it stays. One object per name, each with its own SQLite.
import { DurableObject } from "cloudflare:workers";
import type { Env } from "../app";

export class Counter extends DurableObject<Env> {
  /** One more, kept in this object's storage; returns the new count. */
  async increment(): Promise<number> {
    const count = ((await this.ctx.storage.get<number>("count")) ?? 0) + 1;
    await this.ctx.storage.put("count", count);
    return count;
  }
}
// #endif
