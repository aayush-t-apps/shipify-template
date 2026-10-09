import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ShipError } from "./output.ts";
import { findSecretLike } from "./safety.ts";
import { Manifest } from "./schemas.ts";

export const MANIFEST_FILE = "shipify.json";
export const manifestPath = (dir: string) => join(dir, MANIFEST_FILE);

export function readManifest(dir: string): Manifest {
  const file = manifestPath(dir);
  if (!existsSync(file)) throw new ShipError(`No ${MANIFEST_FILE} in ${dir}.`, "blocked");
  const parsed = Manifest.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) {
    throw new ShipError(
      `${MANIFEST_FILE} is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  return parsed.data;
}

export function writeManifest(dir: string, m: Manifest): void {
  const text = `${JSON.stringify(Manifest.parse(m), null, 2)}\n`;
  const hit = findSecretLike(text);
  if (hit)
    throw new ShipError(
      `Refusing to write ${MANIFEST_FILE}: it looks like it holds a secret (${hit}).`,
    );
  writeFileSync(manifestPath(dir), text);
}
