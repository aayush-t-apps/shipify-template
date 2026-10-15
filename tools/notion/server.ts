// Our Notion tool (ADR 0015, docs/tools.md): an MCP server on stdio, started by the agent for a
// run. It sees only the pages and databases connected to its integration. Looking runs get a
// read-only key; changes are made only by the box, for calls you approved, with the write key.
//   tsx tools/notion/server.ts           serve the tools
//   tsx tools/notion/server.ts --check   check the key once (ship doctor), then exit
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type Tool } from "../mcp.ts";
import {
  blockLines,
  idOf,
  type Notion,
  notion,
  propertyLine,
  schemaLines,
  titleOf,
  toBlocks,
  toProperties,
} from "./notion.ts";

type Json = Record<string, unknown>;
const MAX_TEXT = 6000;

/** A data source (a database's table) by a database's or a data source's link or id. */
async function dataSource(api: Notion, ref: string): Promise<Json> {
  const id = idOf(ref);
  try {
    return await api.call<Json>("GET", `/data_sources/${id}`);
  } catch {
    const db = await api.call<Json>("GET", `/databases/${id}`);
    const first = (db.data_sources as Json[] | undefined)?.[0];
    if (!first) throw new Error("That database has no table to read.");
    return api.call<Json>("GET", `/data_sources/${first.id}`);
  }
}

/** Block types a body replacement never deletes: they hold other pages. */
const KEPT = new Set(["child_page", "child_database"]);
const MAX_BLOCKS = 1000;

/** A block by its kind and first words, for an answer: the toggle "Old receipts". */
const blockName = (b: Json) => {
  const rich = ((b[b.type as string] ?? {}) as Json).rich_text;
  const words = Array.isArray(rich)
    ? rich
        .map((r: Json) => r.plain_text ?? "")
        .join("")
        .trim()
    : "";
  return `the ${String(b.type).replace(/_/g, " ")}${words ? ` "${words.slice(0, 40)}"` : ""}`;
};

/** All of a page's top-level blocks, following Notion's pages of 100. */
async function bodyBlocks(api: Notion, id: string): Promise<Json[]> {
  const all: Json[] = [];
  let cursor: string | undefined;
  do {
    const r = await api.call<{ results: Json[]; has_more: boolean; next_cursor?: string }>(
      "GET",
      `/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`,
    );
    all.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor && all.length < MAX_BLOCKS);
  if (cursor) throw new Error(`That page has more than ${MAX_BLOCKS} blocks: edit it in Notion.`);
  return all;
}

const sourceName = (ds: Json) =>
  (Array.isArray(ds.title) ? ds.title.map((t: Json) => t.plain_text).join("") : "") || "(untitled)";
const pageLine = (p: Json) => {
  const props = propertyLine(p);
  return `- "${titleOf(p)}"${props ? ` · ${props}` : ""} · id ${p.id}`;
};

export function notionTools(api: Notion): Tool[] {
  const str = (input: Json, key: string) => {
    const v = input[key];
    if (typeof v !== "string" || !v.trim()) throw new Error(`"${key}" is needed.`);
    return v;
  };
  return [
    {
      name: "search",
      description: "Look: find pages or databases connected to Shipify, by words in their titles.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Words to look for" },
          kind: {
            type: "string",
            enum: ["page", "database"],
            description: "Only pages, or only databases",
          },
        },
        required: ["query"],
      },
      async run(input) {
        const kind =
          input.kind === "database" ? "data_source" : input.kind === "page" ? "page" : undefined;
        const r = await api.call<{ results: Json[] }>("POST", "/search", {
          query: str(input, "query"),
          page_size: 10,
          ...(kind ? { filter: { property: "object", value: kind } } : {}),
        });
        if (!r.results.length)
          return "Nothing found. Only pages and databases connected to Shipify can be found (in Notion: ⋯ → Connections).";
        return [
          `${r.results.length} found:`,
          ...r.results.map((x) =>
            x.object === "data_source"
              ? `- database "${sourceName(x)}" · id ${x.id} (read_database shows its properties)`
              : `${pageLine(x)} · ${x.url ?? ""}`.trimEnd(),
          ),
        ].join("\n");
      },
    },
    {
      name: "read_page",
      description: "Look: a page's properties and its content, as text.",
      inputSchema: {
        type: "object",
        properties: { page: { type: "string", description: "The page's link or id" } },
        required: ["page"],
      },
      async run(input) {
        const id = idOf(str(input, "page"));
        const page = await api.call<Json>("GET", `/pages/${id}`);
        const blocks = await api.call<{ results: Json[]; has_more: boolean }>(
          "GET",
          `/blocks/${id}/children?page_size=100`,
        );
        let content = blockLines(blocks.results).join("\n");
        if (content.length > MAX_TEXT) content = `${content.slice(0, MAX_TEXT)}\n… (cut short)`;
        const props = propertyLine(page);
        return [
          `"${titleOf(page)}" · ${page.url ?? id}`,
          props && `Properties: ${props}`,
          content ? `\n${content}` : "(no content)",
          blocks.has_more ? "… (more content than shown)" : "",
        ]
          .filter(Boolean)
          .join("\n");
      },
    },
    {
      name: "read_database",
      description: "Look: a database's properties, and the choices each status or select allows.",
      inputSchema: {
        type: "object",
        properties: { database: { type: "string", description: "The database's link or id" } },
        required: ["database"],
      },
      async run(input) {
        const ds = await dataSource(api, str(input, "database"));
        return [
          `Database "${sourceName(ds)}" · id ${ds.id}`,
          "Properties:",
          ...schemaLines((ds.properties ?? {}) as Record<string, Json>),
        ].join("\n");
      },
    },
    {
      name: "query_database",
      description:
        "Look: a database's rows, 25 at a time, optionally filtered or sorted (Notion's filter and sorts format).",
      inputSchema: {
        type: "object",
        properties: {
          database: { type: "string", description: "The database's link or id" },
          filter: {
            type: "object",
            description:
              'Notion\'s filter, e.g. {"property":"Status","status":{"does_not_equal":"Done"}}',
          },
          sorts: { type: "array", items: { type: "object" }, description: "Notion's sorts" },
          cursor: { type: "string", description: "From the last answer, for the next 25" },
        },
        required: ["database"],
      },
      async run(input) {
        const ds = await dataSource(api, str(input, "database"));
        const r = await api.call<{ results: Json[]; has_more: boolean; next_cursor?: string }>(
          "POST",
          `/data_sources/${ds.id}/query`,
          {
            page_size: 25,
            ...(input.filter ? { filter: input.filter } : {}),
            ...(input.sorts ? { sorts: input.sorts } : {}),
            ...(input.cursor ? { start_cursor: input.cursor } : {}),
          },
        );
        return [
          `"${sourceName(ds)}": ${r.results.length} row${r.results.length === 1 ? "" : "s"}`,
          ...r.results.map(pageLine),
          r.has_more ? `More: query again with cursor ${r.next_cursor}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      },
    },
    {
      name: "update_page",
      description:
        'Act: change a page\'s properties, as plain values: {"Status": "Done", "Due": "2026-10-03"}, and/or replace its whole body with new text (lines starting with #, -, - [ ] or 1. become headings and lists; subpages are kept; a page with a block that holds others, like a toggle or columns, is refused). A status or select must be one of its choices.',
      inputSchema: {
        type: "object",
        properties: {
          page: { type: "string", description: "The page's link or id" },
          properties: { type: "object", description: "Property names and their new plain values" },
          content: {
            type: "string",
            description:
              "The page's new text, replacing all of its body (never blank; up to 100 lines of up to 2,000 characters)",
          },
        },
        required: ["page"],
      },
      async run(input) {
        const id = idOf(str(input, "page"));
        const values = input.properties as Json | undefined;
        const hasValues = !!values && Object.keys(values).length > 0;
        if (!hasValues && input.content === undefined)
          throw new Error('Say what to change: "properties", "content", or both.');
        // Everything is checked before anything is written.
        const text = input.content === undefined ? undefined : str(input, "content");
        const fresh = text === undefined ? undefined : toBlocks(text);
        const old = fresh ? await bodyBlocks(api, id) : [];
        const doomed = old.filter((b) => !KEPT.has(String(b.type)));
        // A block with blocks inside (a toggle, columns, a nested list) would take them with it,
        // a subpage among them too, and read_page shows only the top level: never deleted unseen.
        const deep = doomed.filter((b) => b.has_children);
        if (deep.length)
          throw new Error(
            `Nothing was changed: ${deep.slice(0, 3).map(blockName).join(", ")}${
              deep.length > 3 ? ` and ${deep.length - 3} more` : ""
            } ${deep.length === 1 ? "has" : "have"} blocks inside, which replacing the body would delete unseen. Edit this page in Notion.`,
          );
        let updated: Json | undefined;
        if (hasValues) {
          const page = await api.call<Json>("GET", `/pages/${id}`);
          const parent = (page.parent ?? {}) as Json;
          const schema = parent.data_source_id
            ? ((await api.call<Json>("GET", `/data_sources/${parent.data_source_id}`))
                .properties as Record<string, Json>)
            : Object.fromEntries(
                Object.entries((page.properties ?? {}) as Record<string, Json>).map(([n, p]) => [
                  n,
                  { ...p, name: n },
                ]),
              );
          updated = await api.call<Json>("PATCH", `/pages/${id}`, {
            properties: toProperties(values, schema),
          });
        }
        let body = "";
        if (fresh) {
          // The new text goes in first, so a failure part-way leaves old and new, never a lost page.
          await api.call("PATCH", `/blocks/${id}/children`, { children: fresh });
          for (const b of doomed) await api.call("DELETE", `/blocks/${b.id}`);
          const kept = old
            .filter((b) => KEPT.has(String(b.type)))
            .map((b) => String(((b[b.type as string] ?? {}) as Json).title));
          body = `body replaced: ${doomed.length} blocks removed, ${fresh.length} added${
            kept.length ? `; kept: ${kept.join(", ")}` : ""
          }`;
        }
        updated ??= await api.call<Json>("GET", `/pages/${id}`);
        const props = propertyLine(updated);
        return [
          `Updated "${titleOf(updated)}"${props ? `: ${props}` : ""}`,
          body,
          updated.url ?? id,
        ]
          .filter(Boolean)
          .join(" · ");
      },
    },
    {
      name: "create_page",
      description:
        "Act: create a page in a database (a new row) or under a page, with a title, plain property values, and text content (lines starting with #, -, - [ ] or 1. become headings and lists).",
      inputSchema: {
        type: "object",
        properties: {
          parent: { type: "string", description: "The database's or page's link or id" },
          title: { type: "string" },
          properties: {
            type: "object",
            description: "For a database row: property names and plain values",
          },
          content: { type: "string", description: "The page's text" },
        },
        required: ["parent", "title"],
      },
      async run(input) {
        const ref = str(input, "parent");
        const title = str(input, "title");
        const children = typeof input.content === "string" ? toBlocks(input.content) : [];
        let ds: Json | undefined;
        try {
          ds = await dataSource(api, ref);
        } catch {
          ds = undefined;
        }
        let body: Json;
        if (ds) {
          const schema = (ds.properties ?? {}) as Record<string, Json>;
          const titleName =
            Object.entries(schema).find(([, p]) => p.type === "title")?.[0] ?? "Name";
          body = {
            parent: { type: "data_source_id", data_source_id: ds.id },
            properties: toProperties(
              { ...((input.properties as Json | undefined) ?? {}), [titleName]: title },
              schema,
            ),
          };
        } else
          body = {
            parent: { type: "page_id", page_id: idOf(ref) },
            properties: { title: { title: [{ text: { content: title } }] } },
          };
        const created = await api.call<Json>("POST", "/pages", {
          ...body,
          ...(children.length ? { children } : {}),
        });
        return `Created "${titleOf(created)}" · ${created.url ?? created.id}`;
      },
    },
  ];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const api = notion(process.env.NOTION_TOKEN || undefined);
  if (process.argv.includes("--check"))
    api.call<Json>("GET", "/users/me").then(
      (me) => {
        console.log(`The Notion key works (${me.name ?? "integration"}).`);
      },
      (e: Error) => {
        console.error(e.message);
        process.exit(1);
      },
    );
  else void serve({ name: "notion", version: "1.0.0" }, notionTools(api));
}
