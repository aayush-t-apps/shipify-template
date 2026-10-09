// The product and your copy (ADR 0047): Shipify's own files go to the template, one clean commit per
// version (`ship template`), and come back to every copy as one PR (`ship update`, update.yml). Your
// files are never in either: your plans, recipes and checks, and the apps your forms list.
import { FORM_PROJECTS, formIds, setFormProjects } from "./forms.ts";

/** Your folders: in your copy alone. What each keeps of the product's (its README, its examples). */
const YOURS: { dir: string; product: string[] }[] = [
  { dir: "plans/", product: ["plans/.gitkeep"] },
  { dir: "recipes/", product: ["recipes/README.md", "recipes/examples/"] },
  { dir: "checks/", product: ["checks/README.md", "checks/example.mjs"] },
];

/** A file of yours (a tracked path): never published, never touched by an update. */
export const isYours = (path: string) =>
  YOURS.some(
    (y) =>
      path.startsWith(y.dir) &&
      !y.product.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p)),
  );

/** The product's files among these tracked paths: every one but yours. */
export const productFiles = (tracked: string[]) => tracked.filter((p) => !isYours(p));

/** A form as the template has it: its list of apps empty, for each copy's own (`ship forms`). */
export const templateForm = (file: string, text: string) =>
  file in FORM_PROJECTS ? setFormProjects(text, []) : text;

/** A form as an update leaves it: the template's, with the apps this copy's form listed. */
export const keptForm = (file: string, theirs: string, yours: string) =>
  file in FORM_PROJECTS ? setFormProjects(theirs, formIds(yours)) : theirs;

/** A release's tag (`v0.1.1`) as a version, or undefined when it isn't one. */
export const versionOf = (tag: string) => /^v(\d+\.\d+\.\d+)$/.exec(tag)?.[1];
