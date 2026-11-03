// Our Drop tool (docs/tools.md, Drop): an MCP server on stdio, for Drop's /api behind Cloudflare
// Access. Looking runs get the read token; drops are made, changed and revoked only by the box, for
// calls you approved, with the write token. A drop's files are ones the task shared, or ones you sent
// in its chat (by their refs, ADR 0069): the box fetches them for the call into a folder of their
// own (SHIPIFY_FILES), and this reads them there.
//   tsx tools/drop/server.ts           serve the tools
//   tsx tools/drop/server.ts --check   check the token once (ship doctor), then exit
import { randomInt } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type Tool } from "../mcp.ts";
import { type Drop, drop } from "./drop.ts";

type Json = Record<string, unknown>;

/** Drop's Share sheet: who may open a drop (its gate), in plain words. */
const GATES = {
  me: "only you",
  view: "anyone with the link can view",
  add: "anyone with the link can view and add",
  collect: "anyone with the link can send files (and sees only their own)",
  people: "the people on it",
} as const;
type Gate = keyof typeof GATES;
/** A drop has one link at most, and its gate gives its role. People open /d/<address> instead. */
const LINK_ROLE: Partial<Record<Gate, string>> = { view: "view", add: "add", collect: "send" };
const EXPIRY = ["1d", "7d", "30d", "keep"];
const ROLES = ["view", "add"];
/** The most files one drop takes in a call: as many as a task keeps shared. */
const MAX_FILES = 20;
const MAX_LISTED = 50;
/** As Drop's own New drop and Details forms. */
const MAX_TITLE = 120;
const LIMITS = { mb: 2_000, files: 5_000 };

/** A drop as Drop's /api answers it (GET /api/drops; GET /api/drops/:address adds the rest). */
interface DropInfo {
  address: string;
  title: string;
  gate: string;
  pin?: boolean;
  expires?: string | null;
  expired?: boolean;
  peopleCount?: number;
  requestCount?: number;
  /** Its link; `path` from Drop 0.3.0 (a link made before has only its hash). */
  link?: { role: string; path?: string } | null;
  files?: { name: string; size?: number }[];
  people?: { key: string; name?: string | null; email?: string | null; role: string }[];
  /** Who asked to open it (its people's page's Ask for access), as its admin page answers them. */
  requests?: { id: string; email: string }[];
  limits?: { mb: number; files: number };
}
interface Person {
  id: string;
  name: string;
  email?: string | null;
}

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const str = (input: Json, key: string) => {
  const v = input[key];
  if (typeof v !== "string" || !v.trim()) throw new Error(`"${key}" is needed.`);
  return v.trim();
};
const titleOf = (input: Json) => {
  const title = str(input, "title");
  if (title.length > MAX_TITLE) throw new Error(`"title" is ${MAX_TITLE} characters at most.`);
  return title;
};
const names = (input: Json, key: string) => {
  const v = input[key] ?? [];
  if (!Array.isArray(v) || v.some((n) => typeof n !== "string" || !n.trim()))
    throw new Error(`"${key}" is a list of names.`);
  return v as string[];
};
const oneOf = <T extends string>(input: Json, key: string, allowed: readonly string[]) => {
  const v = input[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !allowed.includes(v))
    throw new Error(`"${key}" is one of: ${allowed.join(", ")}.`);
  return v as T;
};
const yesNo = (input: Json, key: string) => {
  const v = input[key];
  if (v !== undefined && typeof v !== "boolean") throw new Error(`"${key}" is true or false.`);
  return v as boolean | undefined;
};
/** A new 6-digit PIN: Drop takes the PIN itself, and keeps only its hash. */
const newPin = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

/** A drop's address from itself or a link to it (/d/<address>.<secret>, /admin/d/<address>). */
export function idOf(ref: string): string {
  const path = ref.split(/[?#]/)[0] ?? ref;
  const last = path.split("/").filter(Boolean).at(-1) ?? "";
  const id = last.split(".")[0] ?? "";
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) throw new Error(`"${ref}" isn't a drop's id or link.`);
  return id;
}

/** Each person by a name, an id or an email, as Drop keys them on a drop: their id, or the email. */
async function whoIs(api: Drop, names: string[]): Promise<Map<string, string>> {
  const people = (await api.call<{ people?: Person[] }>("GET", "/api/people")).people ?? [];
  const out = new Map<string, string>();
  for (const n of names) {
    const low = n.toLowerCase();
    const found = people.filter(
      (p) => p.id === n || p.name.toLowerCase() === low || p.email?.toLowerCase() === low,
    );
    if (found.length > 1)
      throw new Error(`Two people in Drop are called "${n}": use their id or email.`);
    if (found[0]) out.set(n, found[0].id);
    else if (isEmail(n)) out.set(n, low);
    else
      throw new Error(
        `No one called "${n}" in Drop's People: add them there first (Drop → People), or give an email.`,
      );
  }
  return out;
}

/** The answers a call gives to who asked to open a drop: [email, "view" | "add" | "deny"]. */
function answersOf(input: Json): [string, string][] {
  const v = input.requests;
  if (v === undefined) return [];
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error('"requests" is { "<email>": "view", "add" or "deny" }.');
  for (const [who, a] of Object.entries(v))
    if (![...ROLES, "deny"].includes(a as string))
      throw new Error(`"requests": ${who}'s answer is "view", "add" or "deny".`);
  return Object.entries(v as Record<string, string>);
}

/** The people a call gives: { who: "view" | "add" }. */
function peopleOf(input: Json): Record<string, string> | undefined {
  const v = input.people;
  if (v === undefined) return undefined;
  if (!v || typeof v !== "object" || Array.isArray(v) || !Object.keys(v).length)
    throw new Error('"people" is { "<name or email>": "view" or "add" }.');
  for (const [who, role] of Object.entries(v))
    if (!who.trim() || typeof role !== "string" || !ROLES.includes(role))
      throw new Error(`"people": ${who}'s role is "view" or "add".`);
  return v as Record<string, string>;
}

/** The most a drop holds, either or both: { mb, files }. */
function limitsOf(input: Json): { mb?: number; files?: number } | undefined {
  const v = input.limits as Json | undefined;
  if (v === undefined) return undefined;
  const fits = ([k, n]: [string, unknown]) =>
    k in LIMITS && Number.isInteger(n) && (n as number) >= 1 && (n as number) <= LIMITS[k as "mb"];
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    !Object.keys(v).length ||
    !Object.entries(v).every(fits)
  )
    throw new Error(`"limits" is { "mb": 1 to ${LIMITS.mb}, "files": 1 to ${LIMITS.files} }.`);
  return v as { mb?: number; files?: number };
}

/** The files a call names, read from the folder the box fetched them into. */
function filesOf(input: Json): { name: string; bytes: Uint8Array<ArrayBuffer> }[] {
  const v = input.files;
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((f) => typeof f !== "string" || !f.trim()))
    throw new Error('"files" is a list of file names.');
  if (v.length > MAX_FILES) throw new Error(`One drop takes up to ${MAX_FILES} files in a call.`);
  const dir = process.env.SHIPIFY_FILES;
  if (v.length && !dir)
    throw new Error("No files were given to this call: the box fetches them for an approved call.");
  return [...new Set(v.map((f: string) => basename(f)))].map((name) => {
    const file = join(dir as string, name);
    try {
      if (!statSync(file).isFile()) throw new Error();
      return { name, bytes: readFileSync(file) };
    } catch {
      throw new Error(`${name} isn't among the files the box fetched for this call.`);
    }
  });
}

const until = (expires?: string | null, expired?: boolean) =>
  expired ? "expired" : expires ? `until ${expires.slice(0, 10)}` : "kept";
/** Bytes as Drop's admin page counts them: 1 GB is 10⁹ bytes. */
const size = (n: number) => {
  const i = Math.min(3, Math.floor(Math.log10(Math.max(n, 1)) / 3));
  return `${Number((n / 1000 ** i).toFixed(1))} ${["B", "KB", "MB", "GB"][i]}`;
};
const capital = (s: string) => `${s[0]?.toUpperCase()}${s.slice(1)}`;

export function dropTools(api: Drop): Tool[] {
  const at = (address: string) => `/api/drops/${encodeURIComponent(address)}`;
  /** How people open a drop: its people's page, or its link (kept from Drop 0.3.0). */
  const opens = (d: DropInfo) =>
    d.gate === "people"
      ? `people link ${api.url(`/d/${d.address}`)}`
      : !LINK_ROLE[d.gate as Gate]
        ? undefined
        : d.link?.path
          ? `link ${api.url(d.link.path)}`
          : d.link
            ? "its link is from before Drop kept links: new_link makes one to copy"
            : "no link: new_link makes one";
  return [
    {
      name: "list",
      description:
        "Look: your drops (title, id, who can open it and its link, PIN, people, expiry, requests to answer), the space they use, and the people in Drop. A query that finds one drop shows its files, limits and who asks to open it too.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Words in a drop's title, or its id" },
        },
      },
      async run(input) {
        const words = typeof input.query === "string" ? input.query.trim().toLowerCase() : "";
        const { drops: all = [], usage } = await api.call<{
          drops?: DropInfo[];
          usage?: { bytes: number; capBytes: number };
        }>("GET", "/api/drops");
        const drops = words
          ? all.filter(
              (d) => d.title.toLowerCase().includes(words) || d.address.toLowerCase() === words,
            )
          : all;
        const people = (await api.call<{ people?: Person[] }>("GET", "/api/people")).people ?? [];
        // One drop found: what's in it, for update's delete_files.
        const one =
          words && drops.length === 1 && drops[0]
            ? (await api.call<{ drop?: DropInfo }>("GET", at(drops[0].address))).drop
            : undefined;
        const files = one?.files ?? [];
        const inside = one
          ? [
              files.length
                ? `Its ${plural(files.length, "file")}: ${files
                    .slice(0, MAX_LISTED)
                    .map((f) => (f.size === undefined ? f.name : `${f.name} (${size(f.size)})`))
                    .join(", ")}${files.length > MAX_LISTED ? ", …" : ""}.`
                : "No files in it yet.",
              ...(one.limits
                ? [`It holds up to ${one.limits.mb} MB and ${plural(one.limits.files, "file")}.`]
                : []),
              ...(one.requests?.length
                ? [`Asking to open it: ${one.requests.map((r) => r.email).join(", ")}.`]
                : []),
            ]
          : [];
        const lines = drops
          .slice(0, MAX_LISTED)
          .map((d) =>
            [
              `- "${d.title}"`,
              `id ${d.address}`,
              `${GATES[d.gate as Gate] ?? d.gate}${d.pin ? ", with a PIN" : ""}`,
              ...(d.peopleCount ? [plural(d.peopleCount, "person", "people")] : []),
              until(d.expires, d.expired),
              ...(d.requestCount ? [`${plural(d.requestCount, "request")} to answer`] : []),
              opens(d),
            ]
              .filter(Boolean)
              .join(" · "),
          );
        return [
          drops.length
            ? `${plural(drops.length, "drop")}${words ? ` with "${words}"` : ""}:`
            : `No drops${words ? ` with "${words}"` : ""}.`,
          ...lines,
          ...inside,
          ...(drops.length > MAX_LISTED
            ? [`…and ${drops.length - MAX_LISTED} more: add words to find one.`]
            : []),
          ...(usage ? [`Used ${size(usage.bytes)} of ${size(usage.capBytes)} in Drop.`] : []),
          people.length
            ? `People in Drop: ${people.map((p) => p.name).join(", ")}.`
            : "No people in Drop yet (Drop → People adds them).",
        ].join("\n");
      },
    },
    {
      name: "publish",
      description:
        "Act: make a drop from files this task shared (in a reply's files) or ones you sent in its chat (by their refs), and get its link. share: me (only you), view or add (anyone with the link), collect (a link that only takes files), people (those named in people). expiry: 1d, 7d (the default), 30d or keep. pin: true adds a 6-digit PIN.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "The drop's title, as people see it" },
          files: {
            type: "array",
            items: { type: "string" },
            description:
              "Names of files this task shared, as its replies list them, or files you sent in its chat by their refs (`web:f-…`, as its files folder's note says)",
          },
          share: { type: "string", enum: Object.keys(GATES) },
          people: {
            type: "object",
            description: 'For share "people": { "<name in Drop, or email>": "view" or "add" }',
            additionalProperties: { type: "string", enum: ROLES },
          },
          expiry: { type: "string", enum: EXPIRY },
          pin: { type: "boolean", description: "Ask for a 6-digit PIN before anything shows" },
        },
        required: ["title", "share"],
      },
      async run(input) {
        const title = titleOf(input);
        const share = oneOf<Gate>(input, "share", Object.keys(GATES));
        if (!share) throw new Error('"share" is needed.');
        const expiry = oneOf<string>(input, "expiry", EXPIRY) ?? "7d";
        const people = peopleOf(input);
        if ((share === "people") !== Boolean(people))
          throw new Error(
            share === "people"
              ? 'Share with "people" names them in "people".'
              : `"people" goes with share "people", not "${share}".`,
          );
        const pin = yesNo(input, "pin") && newPin();
        if (pin && share === "me") throw new Error('A PIN guards a link: share "me" has none.');
        const files = filesOf(input);
        if (!files.length && share !== "collect")
          throw new Error(
            'Name the files to share in "files" (a drop that collects files needs none).',
          );
        const keys = people ? await whoIs(api, Object.keys(people)) : undefined;
        const made = await api.call<{ drop?: DropInfo; link?: string }>("POST", "/api/drops", {
          title,
          gate: share,
          expiry,
          ...(pin ? { pin } : {}),
        });
        const address = made.drop?.address;
        if (typeof address !== "string" || !address)
          throw new Error("Drop's answer has no drop id: is SHIPIFY_DROP_URL Drop's own address?");
        // Every file and person in, or no drop: a half-made one is removed, so nothing goes out by half.
        let link = made.link;
        const stored: string[] = [];
        try {
          for (const f of files) {
            const r = await api
              .put<{ name?: unknown }>(
                `${at(address)}/files/${encodeURIComponent(f.name)}`,
                f.bytes,
              )
              .catch((e: Error) => {
                throw new Error(`${f.name} couldn't be added (${e.message})`);
              });
            stored.push(typeof r.name === "string" ? r.name : f.name);
          }
          if (people && keys)
            await api
              .call("PATCH", at(address), {
                people: Object.fromEntries(
                  Object.entries(people).map(([who, role]) => [keys.get(who), role]),
                ),
              })
              .catch((e: Error) => {
                throw new Error(`its people couldn't be added (${e.message})`);
              });
          const role = LINK_ROLE[share];
          if (role && !link)
            link = (await api.call<{ link?: string }>("POST", `${at(address)}/links`, { role }))
              .link;
        } catch (e) {
          const removed = await api.call("DELETE", at(address)).then(
            () => "the drop was removed",
            () => `remove drop ${address} in Drop`,
          );
          throw new Error(`Nothing was shared: ${(e as Error).message}, so ${removed}.`);
        }
        const expires = made.drop?.expires;
        const lines = [
          `Made "${title}" (drop ${address}), ${until(expires)}, with ${stored.length ? `${plural(stored.length, "file")}: ${stored.join(", ")}` : "no files yet"}.`,
        ];
        if (link) lines.push(`${capital(GATES[share])}: ${api.url(link)}`);
        if (people)
          lines.push(
            `Shared with ${Object.entries(people)
              .map(([who, role]) => `${who} (${role})`)
              .join(
                ", ",
              )}: it's on their home pages, and its people link is ${api.url(`/d/${address}`)}`,
          );
        if (share === "me") lines.push("Only you can open it.");
        if (pin)
          lines.push(`PIN: ${pin} (asked before anything shows: send it apart from the link).`);
        lines.push(`Manage it in Drop: ${api.url(`/admin/d/${address}`)}`);
        return lines.join("\n");
      },
    },
    {
      name: "update",
      description:
        "Act: change a drop: title; expiry (1d, 7d, 30d, counted from now, or keep); limits ({ mb, files }: the most it holds); files to add (ones this task shared); delete_files (names in the drop); share (me, view, add, collect, people: who may open it, and its link stays the same); people to add or change, remove (people to take off); requests (answer who asked to open it: view, add or deny, by email); pin (true: a new PIN; false: none); new_link (true: a new link, and the old one stops).",
      inputSchema: {
        type: "object",
        properties: {
          drop: { type: "string", description: "The drop's id (drop.list shows it) or its link" },
          title: { type: "string", description: "Its new title" },
          expiry: { type: "string", enum: EXPIRY, description: "Counted from now" },
          limits: {
            type: "object",
            description: `The most it holds: { "mb": 1 to ${LIMITS.mb}, "files": 1 to ${LIMITS.files} }, either or both`,
            properties: { mb: { type: "integer" }, files: { type: "integer" } },
          },
          files: {
            type: "array",
            items: { type: "string" },
            description:
              "Files to add: names of files this task shared, as its replies list them, or files you sent in its chat by their refs",
          },
          delete_files: {
            type: "array",
            items: { type: "string" },
            description: "Files to delete from the drop: their names in it",
          },
          share: { type: "string", enum: Object.keys(GATES) },
          people: {
            type: "object",
            description:
              '{ "<name in Drop, or email>": "view" or "add" }: added, or their role changed',
            additionalProperties: { type: "string", enum: ROLES },
          },
          remove: {
            type: "array",
            items: { type: "string" },
            description: "People to take off: names or emails",
          },
          requests: {
            type: "object",
            description:
              '{ "<email that asked>": "view", "add" or "deny" }: answers who asked to open it',
            additionalProperties: { type: "string", enum: [...ROLES, "deny"] },
          },
          pin: { type: "boolean" },
          new_link: { type: "boolean", description: "A new link: the old one stops at once" },
        },
        required: ["drop"],
      },
      async run(input) {
        const id = idOf(str(input, "drop"));
        const title = input.title === undefined ? undefined : titleOf(input);
        const expiry = oneOf<string>(input, "expiry", EXPIRY);
        const limits = limitsOf(input);
        const remove = names(input, "remove");
        const doomed = [...new Set(names(input, "delete_files"))];
        const share = oneOf<Gate>(input, "share", Object.keys(GATES));
        const people = peopleOf(input) ?? {};
        const pin = yesNo(input, "pin");
        const newLink = yesNo(input, "new_link");
        const files = filesOf(input);
        const answers = answersOf(input);
        if (
          [title, expiry, limits, share, pin].every((v) => v === undefined) &&
          !files.length &&
          !doomed.length &&
          !remove.length &&
          !Object.keys(people).length &&
          !answers.length &&
          !newLink
        )
          throw new Error(
            "Say what to change: title, expiry, limits, files, delete_files, share, people, remove, requests, pin or new_link.",
          );

        const was = (await api.call<{ drop?: DropInfo }>("GET", at(id))).drop;
        if (!was)
          throw new Error("Drop's answer has no drop: is SHIPIFY_DROP_URL Drop's own address?");
        const gate = (share ?? was.gate) as Gate;
        const role = LINK_ROLE[gate];
        if (pin && gate === "me") throw new Error('A PIN guards a link: share "me" has none.');
        if (newLink && !role)
          throw new Error(`"new_link" needs share view, add or collect: this drop is "${gate}".`);
        for (const name of doomed)
          if (!(was.files ?? []).some((f) => f.name === name))
            throw new Error(`${name} isn't in this drop.`);
        const keys = Object.keys(people).length
          ? await whoIs(api, Object.keys(people))
          : new Map<string, string>();
        const off = remove.map((n) => {
          const low = n.toLowerCase();
          const p = (was.people ?? []).find(
            (p) => p.key === n || p.name?.toLowerCase() === low || p.email?.toLowerCase() === low,
          );
          if (!p) throw new Error(`${n} isn't on this drop.`);
          return [n, p.key] as const;
        });
        const asked = answers.map(([email, answer]) => {
          const r = (was.requests ?? []).find((r) => r.email.toLowerCase() === email.toLowerCase());
          if (!r) throw new Error(`${email} hasn't asked to open this drop.`);
          return { email: r.email, id: `${id}.${r.id}`, answer };
        });

        const done: string[] = [];
        const step = async (what: () => Promise<string | undefined>) => {
          try {
            const line = await what();
            if (line) done.push(line);
          } catch (e) {
            throw new Error(
              `${done.length ? `Done: ${done.join("; ")}. Then: ` : "Nothing was changed: "}${(e as Error).message}`,
            );
          }
        };
        // One change a request, as Drop's own admin page sends them: its details as one.
        if (title !== undefined || expiry || limits)
          await step(async () => {
            const r = await api.call<{ drop?: DropInfo }>("PATCH", at(id), {
              title: title ?? was.title,
              ...(limits || was.limits ? { limits: { ...was.limits, ...limits } } : {}),
              ...(expiry ? { expiry } : {}),
            });
            const most = (r.drop?.limits ?? { ...was.limits, ...limits }) as typeof LIMITS;
            return [
              ...(title !== undefined ? [`title: "${title}"`] : []),
              ...(expiry
                ? [
                    expiry === "keep"
                      ? "no expiry"
                      : `expires ${r.drop?.expires?.slice(0, 10) ?? `in ${expiry}`}`,
                  ]
                : []),
              ...(limits ? [`holds up to ${most.mb} MB and ${plural(most.files, "file")}`] : []),
            ].join("; ");
          });
        for (const name of doomed)
          await step(async () => {
            await api.call("DELETE", `${at(id)}/files/${encodeURIComponent(name)}`);
            return `deleted ${name}`;
          });
        for (const f of files)
          await step(async () => {
            const r = await api
              .put<{ name?: unknown }>(`${at(id)}/files/${encodeURIComponent(f.name)}`, f.bytes)
              .catch((e: Error) => {
                throw new Error(`${f.name} couldn't be added (${e.message})`);
              });
            return `added ${typeof r.name === "string" ? r.name : f.name}`;
          });
        let link: string | undefined;
        let now = was;
        const moved = share !== undefined && share !== was.gate;
        if (share && !moved) done.push(`who may open it: ${GATES[share]}, as before`);
        if (share && moved)
          await step(async () => {
            const r = await api.call<{ drop?: DropInfo; link?: string }>("PATCH", at(id), {
              gate: share,
            });
            link = r.link;
            // Drop 0.3.0 keeps the link it had: ask it which, when its answer doesn't say.
            if (!link && role)
              now =
                (r.drop && "link" in r.drop
                  ? r.drop
                  : (await api.call<{ drop?: DropInfo }>("GET", at(id))).drop) ?? now;
            return share === "me"
              ? "who may open it: only you (not its link, nor its people)"
              : share === "people"
                ? `who may open it: the people on it, at ${api.url(`/d/${id}`)}`
                : `who may open it: ${GATES[share]}`;
          });
        if (off.length || keys.size)
          await step(async () => {
            await api.call("PATCH", at(id), {
              people: {
                ...Object.fromEntries(Object.entries(people).map(([n, r]) => [keys.get(n), r])),
                ...Object.fromEntries(off.map(([, key]) => [key, null])),
              },
            });
            return [
              ...Object.entries(people).map(([n, r]) => `${n} can ${r}`),
              ...off.map(([n]) => `${n} taken off`),
            ].join("; ");
          });
        // As Drop's Requests page answers one: allow with a role, or deny.
        for (const r of asked)
          await step(async () => {
            const allow = r.answer !== "deny";
            await api.call(
              "POST",
              `/api/requests/${encodeURIComponent(r.id)}/${allow ? "allow" : "deny"}`,
              allow ? { role: r.answer } : undefined,
            );
            return allow ? `${r.email} can ${r.answer}` : `${r.email} turned down`;
          });
        if (pin !== undefined)
          await step(async () => {
            const code = pin ? newPin() : null;
            await api.call("PATCH", at(id), { pin: code });
            return code ? `PIN: ${code} (the old one stops)` : "no PIN";
          });
        const had = Boolean(now.link);
        if (role && !link && (newLink || (moved && !had)))
          await step(async () => {
            link = (await api.call<{ link?: string }>("POST", `${at(id)}/links`, { role })).link;
            return undefined;
          });
        if (link)
          done.push(
            `${capital(GATES[gate])}: ${api.url(link)}${had ? " (the old link stops now)" : ""}`,
          );
        else if (moved && role)
          done.push(
            now.link?.path
              ? `${capital(GATES[gate])}: ${api.url(now.link.path)} (the same link)`
              : "its link stays the same: new_link makes one to copy, and the old one stops",
          );
        return `Updated "${was.title}" (drop ${id}):\n${done.map((d) => `- ${d}`).join("\n")}`;
      },
    },
    {
      name: "revoke",
      description: "Act: delete a drop and its files. Its links stop at once.",
      inputSchema: {
        type: "object",
        properties: {
          drop: { type: "string", description: "The drop's id (drop.list shows it) or its link" },
        },
        required: ["drop"],
      },
      async run(input) {
        const id = idOf(str(input, "drop"));
        await api.call("DELETE", at(id));
        return `Revoked drop ${id}: its links stop now, and its files are deleted.`;
      },
    },
  ];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const api = drop({
    url: process.env.DROP_URL || undefined,
    id: process.env.DROP_CLIENT_ID || undefined,
    secret: process.env.DROP_CLIENT_SECRET || undefined,
  });
  if (process.argv.includes("--check"))
    api.call<{ drops?: unknown[] }>("GET", "/api/drops").then(
      (r) => {
        console.log(`The Drop token works (${r.drops?.length ?? 0} drops).`);
      },
      (e: Error) => {
        console.error(e.message);
        process.exit(1);
      },
    );
  else void serve({ name: "drop", version: "1.0.0" }, dropTools(api));
}
