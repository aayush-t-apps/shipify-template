import { z } from "zod";
import { ExecutorEntry } from "./plugins/agent.ts";

export const ProjectId = z.string().regex(/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/);
export const Visibility = z.enum(["public", "private"]);
export const Kind = z.enum(["app", "package"]);
const Ref = z.object({ id: z.string(), version: z.string() });

const Version = z.string().regex(/^\d+\.\d+\.\d+$/, "must be x.y.z");
/** A stack option's name (a stack offers them; a plan picks them): "kv", "d1". */
export const OptionName = z.string().regex(/^[a-z][a-z0-9]*$/);
const SecretName = z.string().regex(/^[A-Z][A-Z0-9_]*$/);
const Url = z.string().url();

/** shipify.json at the root of every project. Names only: never secret values. */
export const Manifest = z.object({
  shipify: z.literal(1),
  id: ProjectId,
  name: z.string().min(1),
  description: z.string(),
  kind: Kind,
  /** The project version: the source of truth for tags, releases and /health. */
  version: Version,
  stack: Ref,
  preset: Ref.nullable(),
  /** Apps: staging environment + release PR before production (ADR 0003). */
  staging: z.boolean(),
  /** Apps: the deployed name (URL name), when it differs from the id. */
  service: ProjectId.nullable(),
  repository: z.object({ visibility: Visibility, url: Url.optional() }),
  urls: z.object({ production: Url.optional(), staging: Url.optional() }),
  /** Apps: a path on each URL that returns JSON with the deployed `commit` (the smoke test). */
  health: z.string().startsWith("/").nullable(),
  /** Secret names. `deploy`: CI only (the pipeline's make targets). `runtime`: the running app. */
  secrets: z.object({ deploy: z.array(SecretName), runtime: z.array(SecretName) }),
  /** Public configuration names set as repository variables. */
  vars: z.array(SecretName),
  /** false: no versions, changelog or tags; PRs preview and merges deploy (the playground). */
  releases: z.boolean().optional(),
  /** The stack's options this project took (its stack.json or layers' `options`). */
  options: z.array(OptionName).optional(),
  platformVersion: z.string(),
  createdAt: z.string().datetime(),
});
export type Manifest = z.infer<typeof Manifest>;

/** Front matter of plans/<id>.plan.md (creation requests). */
export const PlanFrontMatter = z.object({
  app: ProjectId,
  title: z.string().min(3),
  summary: z.string().min(10),
  stack: z.string(),
  preset: z.string(),
  visibility: Visibility,
  staging: z.boolean().default(false),
  /** Runtime secret names the app needs (set as repository secrets by publish). */
  secrets: z.array(SecretName).default([]),
  /** Apps: the deployed (URL) name when it should differ from the project id. */
  service: ProjectId.optional(),
  /** The stack's options to take, by name ("kv", "d1"): what each is, its stack says. */
  options: z.array(OptionName).default([]),
  revision: z.number().int().positive(),
  /** The task that asked for it (ADR 0017): `owner/shipify#12`, written by `ship plan new`. */
  task: z.string().optional(),
});
export type PlanFrontMatter = z.infer<typeof PlanFrontMatter>;

/** stacks/<id>/stack.json: a starting point for projects, and the few facts core needs about it. */
export const StackDef = z
  .object({
    id: z.string(),
    version: Version,
    description: z.string(),
    kind: Kind,
    /** Shared layers rendered first, e.g. ["_base", "_ts"]. */
    layers: z.array(z.string()).default([]),
    /** Stack-specific values for {{VARS}} in its files and layers. */
    vars: z.record(z.string(), z.string()).default({}),
    /** Globs of files this stack owns in projects (besides its layers' layer.json), for upgrades. */
    owned: z.array(z.string()).default([]),
    /** Commands the stack needs on the PC (`ship doctor` checks them). */
    requires: z.array(z.string()).default([]),
    /** Only the contract: the project implements the make targets, so generation skips them. */
    contractOnly: z.boolean().default(false),
    /** Its files need a preset's (its main screen): a project names one of its presets. */
    presetRequired: z.boolean().default(false),
    /** Apps: what publishing and the pipeline need. Values are rendered with project variables. */
    deploy: z
      .object({
        /** Repository secret → the local credential that holds its value. */
        secrets: z.record(SecretName, SecretName).default({}),
        /** Repository variables, valued from your copy's settings (ADR 0047): a run's environment, then this PC's credentials. */
        vars: z.array(SecretName).default([]),
        /**
         * Optional values for templates (your own domain: APPS_DOMAIN), from the environment, then
         * the credentials file. Unset, a template that names one is skipped for the next in its list.
         */
        optionalVars: z.array(SecretName).default([]),
        /** URL templates; a list means the first whose variables are all set. */
        urls: z.object({
          production: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
          staging: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
        }),
        health: z.string().startsWith("/").nullable().default(null),
      })
      .optional(),
    /** `--source <dir>`: copy an existing site into this directory, skipping these names. */
    import: z.object({ into: z.string(), skip: z.array(z.string()).default([]) }).optional(),
    /** Text a plan for this stack must contain (sections and keys). */
    plan: z.object({ require: z.array(z.string()).default([]) }).default({ require: [] }),
    /** Extra `ship doctor` checks: a shell command that exits 0 when all is well. */
    doctor: z.array(z.object({ name: z.string(), run: z.string(), fix: z.string() })).default([]),
    /**
     * Options a project may take (besides its layers'), by name: what each adds, in a line. Its
     * templates see OPTION_<NAME> (and OPTION_<NAME>_STAGING) as true or false.
     */
    options: z.record(OptionName, z.string()).default({}),
  })
  .strict();
export type StackDef = z.infer<typeof StackDef>;

export const PresetDef = z.object({
  id: z.string(),
  version: z.string(),
  description: z.string(),
  /** Stacks this preset works with. */
  stacks: z.array(z.string()).min(1),
});
export type PresetDef = z.infer<typeof PresetDef>;

export const RegistryEntry = z.object({
  id: ProjectId,
  kind: Kind,
  path: z.string(),
  repository: z.string().optional(),
  visibility: Visibility,
  stack: z.string(),
  preset: z.string().nullable(),
  staging: z.boolean(),
  urls: z.object({ production: z.string().optional(), staging: z.string().optional() }),
  registeredAt: z.string(),
});
export type RegistryEntry = z.infer<typeof RegistryEntry>;

export const Registry = z.object({ schemaVersion: z.literal(1), projects: z.array(RegistryEntry) });
export type Registry = z.infer<typeof Registry>;

/** executors.json: each agent (plugins/agent.ts). */
export const Executors = z.record(z.string(), ExecutorEntry);
export type Executors = z.infer<typeof Executors>;
