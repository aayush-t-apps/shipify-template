// An example tool (copy to tools/<name>/server.ts): an MCP server on stdio (ADR 0015, ADR 0031).
// The agent starts it for its look calls, with the read-only key; the box starts it with the write
// key to make the act calls the owner approved.
//   tsx tools/<name>/server.ts           serve the calls
//   tsx tools/<name>/server.ts --check   check the key once (ship doctor), then exit
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type Tool } from "../mcp.ts";

const API = "https://api.example.com";

async function call<T>(key: string | undefined, method: string, path: string, body?: unknown) {
  if (!key) throw new Error("EXAMPLE_TOKEN isn't set on this run.");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`The service said no (HTTP ${res.status}).`);
  return (await res.json()) as T;
}

export function exampleTools(key: string | undefined): Tool[] {
  return [
    {
      name: "search",
      description: "Find items by words in their title. Look.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
      async run(input) {
        const found = await call<{ items: { id: string; title: string }[] }>(
          key,
          "GET",
          `/items?q=${encodeURIComponent(String(input.query))}`,
        );
        return found.items.map((i) => `${i.title} · ${i.id}`).join("\n") || "Nothing found.";
      },
    },
    {
      name: "update_item",
      description: "Change an item's title. Act: made by the box after the owner's yes.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" }, title: { type: "string" } },
        required: ["id", "title"],
      },
      async run(input) {
        await call(key, "PATCH", `/items/${String(input.id)}`, { title: input.title });
        return `Renamed ${String(input.id)} to "${String(input.title)}".`;
      },
    },
  ];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const key = process.env.EXAMPLE_TOKEN || undefined;
  if (process.argv.includes("--check"))
    call<{ name?: string }>(key, "GET", "/me").then(
      (me) => console.log(`The example key works (${me.name ?? "ok"}).`),
      (e: Error) => {
        console.error(e.message);
        process.exit(1);
      },
    );
  else void serve({ name: "example", version: "1.0.0" }, exampleTools(key));
}
