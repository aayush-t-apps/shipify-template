// Your repos as GitHub knows them (ADR 0031, ADR 0044, ADR 0045): each repo an App reaches, not
// archived. On Shipify's own account (the bot's), a project is one with a shipify.json, and the
// others are repos a change works on its own way. On another of your accounts (the repos App's),
// every repo keeps its own rules and is named by its owner/name. A box keeps no project registry,
// so its runs read this instead: the due run for the apps the edge lists and the watch checks, a
// run's plan for the projects and repos a task can name and its agent can read. Read with each
// App's read-only token; once per token and process.

import { repoName } from "./generate.ts";
import { ghJson, ghRun, platformRepo } from "./github.ts";

export interface ProjectOnGitHub {
  id: string;
  kind: string;
  /** Its repo, `owner/name`. */
  repo: string;
  /** Its production address, https only. */
  url?: string;
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
  for (const r of (all ?? []).filter((x) => !x.archived)) {
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
    const res = ghRun(["api", `repos/${r.full_name}/contents/shipify.json`, "--jq", ".content"], {
      token,
    });
    let project: ProjectOnGitHub | undefined;
    if (!res.code)
      try {
        const m = JSON.parse(Buffer.from(res.stdout.trim(), "base64").toString("utf8")) as {
          id?: string;
          kind?: string;
          urls?: { production?: string };
        };
        if (m.kind) {
          const url = m.urls?.production;
          project = {
            id: m.id ?? r.name,
            kind: m.kind,
            repo: r.full_name,
            ...(url && /^https:\/\//.test(url) ? { url } : {}),
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
