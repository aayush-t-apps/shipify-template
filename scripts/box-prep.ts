// What each stack needs on a box, as box/setup.sh reads it: the Docker image's build takes it
// (box/Dockerfile, ADR 0056). `pnpm exec tsx scripts/box-prep.ts > box/prep.tsv`
import { stackPrep } from "../cli/commands/box.ts";

process.stdout.write(`${stackPrep()}\n`);
