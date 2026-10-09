import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PLATFORM_ROOT } from "./config.ts";
import { ShipError } from "./output.ts";
import { PresetDef, StackDef } from "./schemas.ts";

export interface Stack extends StackDef {
  dir: string;
}
export interface Preset extends PresetDef {
  dir: string;
}

function readDefs<T>(sub: string, file: string, parse: (x: unknown) => T): (T & { dir: string })[] {
  const base = join(PLATFORM_ROOT, sub);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter(
      (d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(join(base, d.name, file)),
    )
    .map((d) => {
      const path = join(base, d.name, file);
      try {
        return { ...parse(JSON.parse(readFileSync(path, "utf8"))), dir: join(base, d.name) };
      } catch (e) {
        throw new ShipError(`${sub}/${d.name}/${file} is invalid: ${(e as Error).message}`);
      }
    });
}

export const listStacks = (): Stack[] => readDefs("stacks", "stack.json", (x) => StackDef.parse(x));
export const listPresets = (): Preset[] =>
  readDefs("presets", "preset.json", (x) => PresetDef.parse(x));

export function findStack(id: string): Stack {
  const stack = listStacks().find((t) => t.id === id);
  if (!stack) throw new ShipError(`Unknown stack "${id}". See: pnpm ship stacks`, "blocked");
  return stack;
}

/** Owned-file globs of a stack: its layers' layer.json plus its own list. */
export function ownedGlobs(stack: Stack, root = PLATFORM_ROOT): string[] {
  const layers = stack.layers.flatMap((l) => {
    const f = join(root, "stacks", l, "layer.json");
    return existsSync(f)
      ? ((JSON.parse(readFileSync(f, "utf8")) as { owned?: string[] }).owned ?? [])
      : [];
  });
  return [...layers, ...stack.owned];
}

/** The options a stack offers: its layers' layer.json `options`, then its own. */
export function stackOptions(stack: Stack, root = PLATFORM_ROOT): Record<string, string> {
  const layers = stack.layers.map((l) => {
    const f = join(root, "stacks", l, "layer.json");
    return existsSync(f)
      ? ((JSON.parse(readFileSync(f, "utf8")) as { options?: Record<string, string> }).options ??
          {})
      : {};
  });
  return Object.assign({}, ...layers, stack.options);
}

/** Which of these a stack doesn't offer, said as a fix. */
export function unknownOptions(stack: Stack, picked: string[]): string | undefined {
  const offered = Object.keys(stackOptions(stack));
  const bad = picked.filter((o) => !offered.includes(o));
  if (!bad.length) return undefined;
  return `Stack ${stack.id} has no option ${bad.join(", ")}${offered.length ? `: it offers ${offered.join(", ")}` : ": it offers none"}.`;
}

export function resolveSelection(stackId: string, presetId: string | null) {
  const stack = findStack(stackId);
  let preset: Preset | null = null;
  if (presetId && presetId !== "none") {
    preset = listPresets().find((p) => p.id === presetId) ?? null;
    if (!preset)
      throw new ShipError(`Unknown preset "${presetId}". See: pnpm ship presets`, "blocked");
    if (!preset.stacks.includes(stack.id)) {
      throw new ShipError(`Preset "${preset.id}" doesn't support stack "${stack.id}".`, "blocked");
    }
  }
  return { stack, preset };
}
