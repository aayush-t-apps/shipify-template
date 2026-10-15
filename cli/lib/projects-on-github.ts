// Your repos as GitHub knows them (ADR 0031, ADR 0044, ADR 0045): each repo an App reaches, not
// archived. On Shipify's own account (the bot's), a project is one with a shipify.json, and the
// others are repos a change works on its own way. On another of your accounts (the repos App's),
// every repo keeps its own rules and is named by its owner/name. A box keeps no project registry,
// so its runs read this instead: the due run for the apps the edge lists and the watch checks, a
// run's plan for the projects and repos a task can name and its agent can read. Read with each
// App's read-only token, once per token and process: the list, then every repo's shipify.json in
// one GraphQL query (50 repos a query), so a run's plan makes two calls, not one per repo.

import { repoName } from "./generate.ts";
import { ghJson, ghRun, platformRepo } from "./github.ts";
import { ShipError } from "./output.ts";

export interface ProjectOnGitHub {
  id: string;
  kind: string;
  /** Its repo, `owner/name`. */
  repo: string;
  /** Its production address, https only. */
  url?: string;
  /** The stack it's on, and which version of it (its shipify.json). */
  stack?: { id: string; version: string };
}

/**
 * A repo a task can name (ADR 0044): a project by its id, another repo on Shipify's own account by
 * its name, or a repo on another of your accounts by its owner/name (ADR 0045).
 */
export interface RepoRef {
  /** What a task's words call it: a project's id, the repo's own name, or its owner/name. */
  name: string;
  /** Its repo, `owner/name`. */
  repo: string;
  /** GitHub's `size` in KB: the packed history, so the most any clone of it downloads. */
  sizeKB: number;
  /** It keeps the project contract (a shipify.json); the others keep their own rules. */
  project: boolean;
  /** Its default branch: a repo's PR goes against it (ADR 0045); a project's is `main`. */
  branch: string;
  /** Its owner's GitHub id, on another of your accounts (ADR 0045): what that account is pinned by. */
  ownerId?: number;
}

interface Listed {
  projects: ProjectOnGitHub[];
  repos: RepoRef[];
}

const cache = new Map<string, Listed>();

/** How many repos one GraphQL query reads a shipify.json from. */
const PER_QUERY = 50;
/** An owner/name as GitHub allows them: nothing else goes into a query. */
const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

/**
 * Each repo's shipify.json on its default branch, by owner/name: one GraphQL query per 50 repos,
 * not a read each, since a box's plan lists your repos on every run. GitHub answers what it could
 * read (and gh exits 1 when any part couldn't be): a repo it couldn't, or with no shipify.json, has
 * none here. A query with no answer at all stops the list with GitHub's words, so no project is
 * ever taken for a plain repo.
 */
function manifestsOf(repos: string[], token: string): Map<string, string> {
  const found = new Map<string, string>();
  const named = repos.filter((r) => REPO.test(r));
  for (let i = 0; i < named.length; i += PER_QUERY) {
    const batch = named.slice(i, i + PER_QUERY);
    const fields = batch.map((full, k) => {
      const [owner, name] = full.split("/");
      return `r${k}:repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}){object(expression:"HEAD:shipify.json"){...on Blob{text}}}`;
    });
    const r = ghRun(["api", "graphql", "-f", `query=query{${fields.join(" ")}}`], { token });
    let data: Record<string, { object?: { text?: unknown } | null } | null> | undefined;
    try {
      data = (JSON.parse(r.stdout) as { data?: typeof data }).data ?? undefined;
    } catch {}
    if (!data)
      throw new ShipError(
        `Couldn't read your repos' shipify.json from GitHub: ${(r.stderr || r.stdout).trim().split("\n")[0]}`,
      );
    batch.forEach((full, k) => {
      const text = data?.[`r${k}`]?.object?.text;
      if (typeof text === "string") found.set(full, text);
    });
  }
  return found;
}

/** One App's repos. `account`: another of yours, whose repos are never projects (no shipify.json
 * is read there). */
function listed(token: string, account?: string): Listed {
  const had = cache.get(token);
  if (had) return had;
  // Every page: an org with the App on all its repos can have more than one.
  const all = ghJson<
    {
      repositories?: {
        name: string;
        full_name: string;
        archived?: boolean;
        size?: number;
        default_branch?: string;
        owner?: { id?: number };
      }[];
    }[]
  >(["api", "installation/repositories?per_page=100", "--paginate", "--slurp"], {
    token,
  }).flatMap((page) => page.repositories ?? []);
  const projects: ProjectOnGitHub[] = [];
  const repos: RepoRef[] = [];
  const live = (all ?? []).filter((x) => !x.archived);
  // Another account's repos are never projects: no shipify.json is read there.
  const manifests = account
    ? new Map<string, string>()
    : manifestsOf(
        live.map((r) => r.full_name),
        token,
      );
  for (const r of live) {
    const sizeKB = r.size ?? 0;
    const branch = r.default_branch ?? "main";
    if (account) {
      repos.push({
        name: r.full_name,
        repo: r.full_name,
        sizeKB,
        project: false,
        branch,
        ...(r.owner?.id ? { ownerId: r.owner.id } : {}),
      });
      continue;
    }
    const text = manifests.get(r.full_name);
    let project: ProjectOnGitHub | undefined;
    if (text)
      try {
        const m = JSON.parse(text) as {
          id?: string;
          kind?: string;
          urls?: { production?: string };
          stack?: { id?: unknown; version?: unknown };
        };
        if (m.kind) {
          const url = m.urls?.production;
          const st = m.stack;
          project = {
            id: m.id ?? r.name,
            kind: m.kind,
            repo: r.full_name,
            ...(url && /^https:\/\//.test(url) ? { url } : {}),
            ...(typeof st?.id === "string" && typeof st.version === "string"
              ? { stack: { id: st.id, version: st.version } }
              : {}),
          };
        }
      } catch {}
    if (project) projects.push(project);
    repos.push({
      name: project?.id ?? r.name,
      repo: r.full_name,
      sizeKB,
      project: Boolean(project),
      branch,
    });
  }
  projects.sort((a, b) => a.id.localeCompare(b.id));
  repos.sort((a, b) => a.name.localeCompare(b.name));
  const list = { projects, repos };
  cache.set(token, list);
  return list;
}

/** Your projects: the repos with a shipify.json. */
export function projectsOnGitHub(token: string | undefined): ProjectOnGitHub[] {
  return token ? [...listed(token).projects] : [];
}

/**
 * Every repo a task can name, from one App's list: on Shipify's own account your projects and
 * your other repos; with `account`, that account's repos, by owner/name.
 */
export function reposOnGitHub(token: string | undefined, account?: string): RepoRef[] {
  // A copy: a run adds its account's repos to its own list, never to what's kept for the token.
  return token ? [...listed(token, account).repos] : [];
}

/**
 * The `owner/name` a task's name stands for: the repo the installation lists under it, else a
 * project's own (the platform's owner, the repo prefix and its id), as for a new project whose repo
 * GitHub doesn't list yet. The one place a repo is named from a project's id (ADR 0044).
 */
export function repoFor(name: string, repos: RepoRef[] = []): string {
  // Shipify's own repo is named as the platform's, with no prefix.
  if (name === platformRepo().split("/")[1]) return platformRepo();
  // A repo named by its owner/name (another account's, ADR 0045) is that repo, as the list says it.
  if (name.includes("/"))
    return repos.find((r) => r.repo.toLowerCase() === name.toLowerCase())?.repo ?? name;
  return (
    (repos.find((r) => r.name === name && r.project) ?? repos.find((r) => r.name === name))?.repo ??
    `${platformRepo().split("/")[0]}/${repoName(name)}`
  );
}
