// Status & setup and the model menu (ADR 0036, "☰ Setup"; ADR 0039): what's hard to see on GitHub
// or Telegram, in one place, read-only. The door App can't read the repo's files, so executors.json
// and tools.json are built into the edge when it deploys. Nothing secret is here: names, states and
// public addresses.
import {
  type AgentSeen,
  agentsSeen,
  CHATS,
  INSTANT,
  zoneName,
  effortsFor,
  gatewayName,
} from "../../../cli/contracts/index.ts";
import executors from "../../../executors.json" with { type: "json" };
import pkg from "../../../package.json" with { type: "json" };
import tools from "../../../tools.json" with { type: "json" };
import { CHANNELS } from "../channels/index.ts";
import type { Deps, Env, Kept } from "../env.ts";
import { devicesOf, kvOf, missing } from "../env.ts";
import { github } from "../github.ts";
import { publicKey, serviceOf } from "../push.ts";
import { boxOf, runners, type Settings, statusTask, toBoxes } from "../settings.ts";
import { MOST_BYTES, MOST_FILES } from "./files.ts";
import { REPEAT_KINDS, REPEAT_WHEN, repeatModels } from "./forms.ts";
import { read } from "./gh.ts";
import { type Devices, type Menu, MOST_CHARS, type Setup } from "./shapes.ts";

/** The tool in tools.json that sets the chat up: the one whose way in is the `web` door. */
const tool =
  Object.entries(tools as Record<string, { in?: { door?: string } }>).find(
    ([, t]) => t?.in?.door === "web",
  )?.[0] ?? "";
export const ADD = `pnpm ship add ${tool} --yes`;

type Gateway = { description?: string; key?: string };

/**
 * One agent for the menu: its models, each with its efforts, its Auto, and its efforts (any other
 * model its gateway has takes them).
 */
const menuOf = ([id, e]: readonly [string, AgentSeen]) => ({
  id,
  ...(e.name ? { name: e.name } : {}),
  ...(e.gateway ? { gateway: e.gateway } : {}),
  ...(e.extends ? { of: e.extends } : {}),
  ...(e.gateway ? { via: gatewayName(e.gateway) } : {}),
  efforts: e.efforts ?? [],
  models: (e.models ?? []).map((m) => ({
    id: m,
    efforts: effortsFor(e, m),
    ...(e.about?.[m] ? { about: e.about[m] } : {}),
  })),
  auto: { model: e.auto?.model ?? "", effort: e.auto?.effort ?? "" },
});

/**
 * The agents a `use` line may name, each with its models and Auto, the default one first (the page
 * names any other in a pick: "pi z-ai/glm-5.3"); the default one's models and Auto as before.
 */
export function models() {
  const list = agentsSeen();
  const d = menuOf(list[0] ?? ["", {}]);
  return { agents: list.map(menuOf), models: d.models, auto: d.auto };
}

/** The default agent's id, for a task's model said as a pick ("pi z-ai/glm-5.3" names its agent). */
export const defaultAgentId = () => models().agents[0]?.id ?? "";

/** The gateways, and whether `ship add` set each one's key (SHIPIFY_GATEWAYS: when). */
function gateways(s: Settings) {
  const all = (executors as { gateways?: Record<string, Gateway> }).gateways ?? {};
  return Object.entries(all).map(([id, g]) => ({
    id,
    about: g.description ?? "",
    ...(s.gateways[id] ? { since: s.gateways[id] } : {}),
  }));
}

/** The most repos a new chat's "Change a repo" offers: past that, you type its name. */
const MOST_STARTERS = 40;

/** The key a page subscribes with for notifications (ADR 0050), when the edge has one. */
export const pushKey = (env: Env) => (env.WEB_PUSH_KEY ? publicKey(env.WEB_PUSH_KEY) : undefined);

/** Devices kept, for people: a short id from the address (never the address), service, since. */
export const devicesSeen = (list: Kept[]): Promise<Devices["devices"]> =>
  Promise.all(
    list.map(async (d) => ({
      id: await deviceId(d.endpoint),
      service: serviceOf(d.endpoint) ?? "",
      since: new Date(d.at).toISOString(),
    })),
  );

/** A device's short id: its address's SHA-256, its first 8 hex characters (the page makes it too). */
export async function deviceId(endpoint: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return [...new Uint8Array(hash).slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function menu(env: Env, deps: Deps, files: boolean): Promise<Menu> {
  const record = await statusTask(github(env, deps))
    .then((s) => s?.record)
    .catch(() => undefined);
  const key = pushKey(env);
  return {
    v: 1,
    ...models(),
    // "Change a repo" (ADR 0047): Shipify's own account's repos, as the record keeps them.
    repos: (record?.repos.names ?? []).slice(0, MOST_STARTERS),
    commands: [
      ...CHATS.map((c): [string, string] => [c.chat, c.says]),
      ...INSTANT.map(([c, says]): [string, string] => [c, says]),
    ],
    files: { on: files, most: MOST_FILES, bytes: MOST_BYTES },
    ...(key ? { notifications: { key } } : {}),
    chars: MOST_CHARS,
    // Times are the owner's zone's: the form says which ("09:00 IST").
    repeat: {
      kinds: [...REPEAT_KINDS],
      models: repeatModels(),
      when: REPEAT_WHEN,
      zone: zoneName(new Date(deps.now()).toISOString()),
    },
    version: pkg.version,
  };
}

const list = (v: unknown) =>
  Array.isArray(v)
    ? v.map((x) => (typeof x === "string" ? x : String((x as { name?: unknown })?.name ?? "")))
    : v && typeof v === "object"
      ? Object.keys(v)
      : [];

export async function setup(env: Env, deps: Deps, s: Settings, chat: string): Promise<Setup> {
  const gh = github(env, deps);
  const kv = kvOf(env);
  const [raw, record, runs, devices] = await Promise.all([
    runners(gh, deps.now(), 30_000).catch(() => []),
    statusTask(gh)
      .then((x) => x?.record)
      .catch(() => undefined),
    read<{ workflow_runs?: { id: number; status: string; display_title: string }[] }>(
      env,
      deps,
      `repos/${gh.repo}/actions/workflows/task.yml/runs?per_page=20`,
    ).catch(() => ({ workflow_runs: [] })),
    // The devices the chat notifies (ADR 0050): one read, only with the key.
    kv && pushKey(env)
      ? devicesOf(kv, "web", chat)
          .then(devicesSeen)
          .catch(() => [])
      : undefined,
  ]);
  // Which task each busy slot is on: each live run's job names its runner (four runs at most).
  const live = (runs.workflow_runs ?? []).filter((r) => r.status === "in_progress").slice(0, 4);
  const onBox = new Map<string, number[]>();
  await Promise.all(
    live.map(async (r) => {
      const n = Number(/^task #(\d+)$/.exec(r.display_title)?.[1] ?? 0);
      const jobs = await read<{ jobs?: { runner_name?: string | null }[] }>(
        env,
        deps,
        `repos/${gh.repo}/actions/runs/${r.id}/jobs?per_page=5`,
      ).catch(() => ({ jobs: [] }));
      for (const j of jobs.jobs ?? []) {
        const runner = raw.find((x) => x.name === j.runner_name);
        if (!runner || !n) continue;
        const box = boxOf(runner);
        onBox.set(box, [...(onBox.get(box) ?? []), n]);
      }
    }),
  );
  const repo = `https://github.com/${gh.repo}`;
  return {
    v: 1,
    door: {
      closed: s.closed,
      version: pkg.version,
      commit: env.GIT_SHA ?? "dev",
      repo: gh.repo,
    },
    boxes: toBoxes(raw).map((b) => {
      const seen = record?.boxes[b.name];
      const console = s.consoles[b.name];
      return {
        ...b,
        tasks: onBox.get(b.name) ?? [],
        look: (seen?.facts ?? []).flatMap((f) => (f.look ? [`${f.name}: ${f.look}`] : [])),
        ...(seen?.at ? { at: seen.at } : {}),
        ...(console ? { console } : {}),
      };
    }),
    // The watch's own view, from the record already read: when it last looked, what's due, what
    // happened lately (the status page has the rest).
    watch: {
      ...(record?.watch.last ? { last: record.watch.last } : {}),
      ...(record?.watch.next ? { next: record.watch.next } : {}),
      events: (record?.events ?? []).slice(0, 5),
    },
    chats: Object.values(CHANNELS).map((ch) => ({
      id: ch.id,
      name: ch.name,
      ready: missing(env, ch.needs).length === 0,
      people: s.people.filter((p) => p.on[ch.id]).length,
    })),
    ...models(),
    gateways: gateways(s),
    apps: (record?.apps ?? []).map((a) => ({
      id: a.id,
      url: a.url,
      failing: Boolean(a.failing),
      paused: Boolean(a.paused),
    })),
    tools: Object.entries(tools as Record<string, unknown>).flatMap(([id, v]) => {
      if (id === "version" || typeof v !== "object" || !v) return [];
      const t = v as {
        description?: string;
        look?: unknown;
        act?: unknown;
        pre?: unknown;
        in?: { door?: string };
      };
      // A chat (its way in is a door) is in Chats, not here.
      if (t.in?.door) return [];
      return [
        {
          id,
          about: t.description ?? "",
          look: list(t.look),
          act: list(t.act),
          pre: list(t.pre),
        },
      ];
    }),
    keyDates: Object.entries(s.keyDates)
      .map(([name, date]) => ({ name, date }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    links: {
      variables: `${repo}/settings/variables/actions`,
      actions: `${repo}/actions`,
      issues: `${repo}/issues`,
    },
    ...(devices ? { devices } : {}),
  };
}
