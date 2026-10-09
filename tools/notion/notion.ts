// Notion's REST API, for our Notion tool (ADR 0015): the calls it makes, and plain text in and
// out. The version is pinned; moving to a new one is a change with tests. Answers stay short, and
// errors say what to do: a page that isn't connected, a key that's wrong or read-only.

export const NOTION_VERSION = "2025-09-03";
const TIMEOUT_MS = 30_000;
const RETRIES = 3;

export interface Notion {
  call<T>(method: string, path: string, body?: unknown): Promise<T>;
}

type Json = Record<string, unknown>;

/** A Notion client with one key. `base` and `fetch` are for tests. */
export function notion(
  key: string | undefined,
  opts: { base?: string; fetch?: typeof fetch; wait?: (ms: number) => Promise<void> } = {},
): Notion {
  const base = opts.base ?? process.env.NOTION_API_URL ?? "https://api.notion.com/v1";
  const doFetch = opts.fetch ?? fetch;
  const wait = opts.wait ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  return {
    async call<T>(method: string, path: string, body?: unknown): Promise<T> {
      if (!key)
        throw new Error(
          "Notion isn't connected on this run: its key isn't set (docs/tools.md, Notion).",
        );
      for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
          res = await doFetch(`${base}${path}`, {
            method,
            headers: {
              Authorization: `Bearer ${key}`,
              "Notion-Version": NOTION_VERSION,
              "Content-Type": "application/json",
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
        } catch (e) {
          throw new Error(`Notion didn't answer (${(e as Error).message}). Try again later.`);
        }
        if (res.status === 429 && attempt < RETRIES) {
          const seconds = Number(res.headers.get("retry-after") ?? 1);
          await wait(Math.min(30, Number.isFinite(seconds) ? seconds : 1) * 1000);
          continue;
        }
        const data = (await res.json().catch(() => ({}))) as Json;
        if (res.ok) return data as T;
        throw new Error(explain(res.status, data));
      }
    },
  };
}

/** What a Notion error means, and what to do about it. */
export function explain(status: number, data: Json): string {
  const code = String(data.code ?? "");
  const message = String(data.message ?? "");
  if (status === 404 || code === "object_not_found")
    return "Not found, or not connected to Shipify: open it in Notion, then ⋯ → Connections → add Shipify (the read and the write integration).";
  if (status === 401 || code === "unauthorized")
    return "Notion refused the key: it's wrong or was revoked. Make a new one, then: pnpm ship add notion --new --yes";
  if (status === 403 || code === "restricted_resource")
    return "This key may not do that: looking runs have a read-only key, and changes happen only in an approved run.";
  if (status === 429) return "Notion is busy (rate limited). Try again in a minute.";
  if (status === 400 || code === "validation_error") return `Notion didn't accept that: ${message}`;
  return `Notion answered ${status}${message ? `: ${message}` : ""}.`;
}

/** A page or database id from an id or a Notion link. */
export function idOf(ref: string): string {
  const hex = ref.replace(/-/g, "").match(/[0-9a-f]{32}/gi);
  if (!hex?.length) throw new Error(`"${ref}" isn't a Notion link or id.`);
  // A link ends with the id; a database link's view comes after "?v=".
  const path = ref.split("?")[0] ?? ref;
  const inPath = path.replace(/-/g, "").match(/[0-9a-f]{32}/gi);
  return (inPath?.at(-1) ?? hex.at(-1)) as string;
}

const plain = (rich: unknown): string =>
  Array.isArray(rich) ? rich.map((r) => (r as Json).plain_text ?? "").join("") : "";

/** A property's value as plain words. */
export function valueText(p: Json): string {
  const v = p[p.type as string] as unknown;
  switch (p.type) {
    case "title":
    case "rich_text":
      return plain(v);
    case "status":
    case "select":
      return String((v as Json | null)?.name ?? "");
    case "multi_select":
      return ((v as Json[] | null) ?? []).map((o) => o.name).join(", ");
    case "checkbox":
      return v ? "yes" : "no";
    case "number":
    case "url":
    case "email":
    case "phone_number":
      return v === null || v === undefined ? "" : String(v);
    case "date": {
      const d = v as Json | null;
      return d ? `${d.start}${d.end ? ` → ${d.end}` : ""}` : "";
    }
    case "people":
      return ((v as Json[] | null) ?? []).map((u) => u.name ?? u.id).join(", ");
    case "relation":
      return `${((v as Json[] | null) ?? []).length} linked`;
    case "created_time":
    case "last_edited_time":
      return String(v ?? "");
    case "formula": {
      const f = v as Json | null;
      return f ? String(f[f.type as string] ?? "") : "";
    }
    case "unique_id": {
      const u = v as Json | null;
      return u ? `${u.prefix ? `${u.prefix}-` : ""}${u.number}` : "";
    }
    case "files":
      return ((v as Json[] | null) ?? []).map((f) => f.name).join(", ");
    default:
      return "";
  }
}

/** A page's title: its title property. */
export function titleOf(page: Json): string {
  const props = (page.properties ?? {}) as Record<string, Json>;
  const title = Object.values(props).find((p) => p.type === "title");
  return (title ? valueText(title) : "") || "(untitled)";
}

/** "Status: Done · Due: 2026-10-03", the non-empty properties other than the title. */
export function propertyLine(page: Json): string {
  const props = (page.properties ?? {}) as Record<string, Json>;
  return Object.entries(props)
    .filter(([, p]) => p.type !== "title")
    .map(([name, p]) => [name, valueText(p)] as const)
    .filter(([, v]) => v)
    .map(([name, v]) => `${name}: ${v}`)
    .join(" · ");
}

/** A data source's properties, with the choices a status, select or multi-select allows. */
export function schemaLines(properties: Record<string, Json>): string[] {
  return Object.entries(properties).map(([name, p]) => {
    const conf = p[p.type as string] as Json | undefined;
    const options = (conf?.options as Json[] | undefined)?.map((o) => o.name);
    return `- ${name} (${p.type})${options?.length ? `: ${options.join(", ")}` : ""}`;
  });
}

/**
 * Plain values to Notion's property format, by each property's type in the data source's schema.
 * A status or select must be one of its choices, so a change never invents one.
 */
export function toProperties(
  values: Record<string, unknown>,
  schema: Record<string, Json>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(values)) {
    const p =
      schema[name] ??
      Object.values(schema).find((s) => String(s.name).toLowerCase() === name.toLowerCase());
    if (!p)
      throw new Error(`There's no property "${name}". It has: ${Object.keys(schema).join(", ")}.`);
    const key = String(p.name ?? name);
    const type = String(p.type);
    const text = value === null || value === undefined ? "" : String(value);
    const choose = () => {
      const options = (((p[type] as Json | undefined)?.options as Json[] | undefined) ?? []).map(
        (o) => String(o.name),
      );
      const match = options.find((o) => o.toLowerCase() === text.toLowerCase());
      if (!match)
        throw new Error(`"${text}" isn't a choice for ${key}. Its choices: ${options.join(", ")}.`);
      return match;
    };
    switch (type) {
      case "title":
        out[key] = { title: [{ text: { content: text } }] };
        break;
      case "rich_text":
        out[key] = { rich_text: text ? [{ text: { content: text } }] : [] };
        break;
      case "status":
        out[key] = { status: { name: choose() } };
        break;
      case "select":
        out[key] = { select: text ? { name: choose() } : null };
        break;
      case "multi_select": {
        const names = Array.isArray(value)
          ? value.map(String)
          : text
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
        out[key] = {
          multi_select: names.map((n) => {
            const options = (
              ((p.multi_select as Json | undefined)?.options as Json[] | undefined) ?? []
            ).map((o) => String(o.name));
            const match = options.find((o) => o.toLowerCase() === n.toLowerCase());
            if (!match)
              throw new Error(
                `"${n}" isn't a choice for ${key}. Its choices: ${options.join(", ")}.`,
              );
            return { name: match };
          }),
        };
        break;
      }
      case "checkbox":
        out[key] = { checkbox: value === true || /^(yes|true|done|1)$/i.test(text) };
        break;
      case "number": {
        const n = Number(value);
        if (!Number.isFinite(n)) throw new Error(`${key} needs a number, not "${text}".`);
        out[key] = { number: n };
        break;
      }
      case "date":
        out[key] = { date: text ? { start: text } : null };
        break;
      case "url":
      case "email":
      case "phone_number":
        out[key] = { [type]: text || null };
        break;
      default:
        throw new Error(`${key} is a ${type} property, which this tool can't set.`);
    }
  }
  return out;
}

/** A page's blocks as text lines. */
export function blockLines(blocks: Json[]): string[] {
  return blocks.map((b) => {
    const v = (b[b.type as string] ?? {}) as Json;
    const t = plain(v.rich_text);
    switch (b.type) {
      case "heading_1":
        return `# ${t}`;
      case "heading_2":
        return `## ${t}`;
      case "heading_3":
        return `### ${t}`;
      case "bulleted_list_item":
        return `- ${t}`;
      case "numbered_list_item":
        return `1. ${t}`;
      case "to_do":
        return `- [${v.checked ? "x" : " "}] ${t}`;
      case "quote":
      case "callout":
        return `> ${t}`;
      case "code":
        return `\`\`\`\n${t}\n\`\`\``;
      case "divider":
        return "---";
      case "child_page":
        return `(page: ${v.title})`;
      case "child_database":
        return `(database: ${v.title})`;
      default:
        return t;
    }
  });
}

/** Text to blocks: "# ", "## ", "### ", "- ", "- [ ] ", "1. " and paragraphs, one per line. */
export function toBlocks(text: string): Json[] {
  const block = (type: string, content: string, extra: Json = {}) => ({
    object: "block",
    type,
    [type]: { rich_text: [{ type: "text", text: { content: content.slice(0, 2000) } }], ...extra },
  });
  const kinds: [RegExp, (m: RegExpExecArray) => Json][] = [
    [/^### (.*)/, (m) => block("heading_3", m[1] as string)],
    [/^## (.*)/, (m) => block("heading_2", m[1] as string)],
    [/^# (.*)/, (m) => block("heading_1", m[1] as string)],
    [/^- \[([ xX])\] (.*)/, (m) => block("to_do", m[2] as string, { checked: m[1] !== " " })],
    [/^[-*] (.*)/, (m) => block("bulleted_list_item", m[1] as string)],
    [/^\d+\. (.*)/, (m) => block("numbered_list_item", m[1] as string)],
  ];
  return text
    .split("\n")
    .filter((l) => l.trim())
    .slice(0, 100)
    .map((line) => {
      const l = line.trimEnd();
      for (const [re, make] of kinds) {
        const m = re.exec(l);
        if (m) return make(m);
      }
      return block("paragraph", l);
    });
}
