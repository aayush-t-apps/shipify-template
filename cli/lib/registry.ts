import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { PLATFORM_ROOT } from "./config.ts";
import { MANIFEST_FILE, readManifest } from "./manifest.ts";
import { type Manifest, Registry, type RegistryEntry } from "./schemas.ts";

/** registry/projects.json is a convenience index. Manifests are the source of truth (reconcile). */
export const registryFile = (root = PLATFORM_ROOT) =>
  process.env.SHIPIFY_REGISTRY_FILE ?? join(root, "registry", "projects.json");

export function loadRegistry(root = PLATFORM_ROOT): Registry {
  const file = registryFile(root);
  if (!existsSync(file)) return { schemaVersion: 1, projects: [] };
  return Registry.parse(JSON.parse(readFileSync(file, "utf8")));
}

export function saveRegistry(reg: Registry, root = PLATFORM_ROOT): void {
  reg.projects.sort((a, b) => a.id.localeCompare(b.id));
  // Write then rename, so a reader (or a parallel ship) never sees a half-written file.
  const file = registryFile(root);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(Registry.parse(reg), null, 2)}\n`);
  renameSync(tmp, file);
}

export function entryFromManifest(m: Manifest, dir: string, root = PLATFORM_ROOT): RegistryEntry {
  return {
    id: m.id,
    kind: m.kind,
    path: relative(root, resolve(dir)),
    repository: m.repository.url,
    visibility: m.repository.visibility,
    stack: `${m.stack.id}@${m.stack.version}`,
    preset: m.preset ? `${m.preset.id}@${m.preset.version}` : null,
    staging: m.staging,
    urls: m.urls,
    registeredAt: new Date().toISOString(),
  };
}

export function upsert(reg: Registry, entry: RegistryEntry): Registry {
  const existing = reg.projects.find((a) => a.id === entry.id);
  const projects = reg.projects.filter((a) => a.id !== entry.id);
  projects.push(existing ? { ...entry, registeredAt: existing.registeredAt } : entry);
  return { ...reg, projects };
}

/** Rebuild the index from manifests found in the projects directory. */
export function scanProjects(dir: string, root = PLATFORM_ROOT): RegistryEntry[] {
  if (!existsSync(dir)) return [];
  // A worktree (its .git is a file) is another checkout of a project, not a project.
  const isWorktree = (p: string) =>
    existsSync(join(p, ".git")) && statSync(join(p, ".git")).isFile();
  return readdirSync(dir, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() &&
        !d.name.startsWith(".") &&
        existsSync(join(dir, d.name, MANIFEST_FILE)) &&
        !isWorktree(join(dir, d.name)),
    )
    .map((d) => entryFromManifest(readManifest(join(dir, d.name)), join(dir, d.name), root));
}
