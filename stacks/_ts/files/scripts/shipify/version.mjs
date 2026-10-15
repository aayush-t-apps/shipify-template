// Stack-owned (Shipify; replaced by `ship upgrade`). `make version` copies the project version from
// shipify.json, its source of truth, into package.json. `ship version` runs it after each bump.
import { readFileSync, writeFileSync } from "node:fs";

const version =
  process.env.SHIPIFY_VERSION || JSON.parse(readFileSync("shipify.json", "utf8")).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`make version: "${version}" is not a version like 1.2.3.`);
  process.exit(1);
}
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
pkg.version = version;
writeFileSync("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
