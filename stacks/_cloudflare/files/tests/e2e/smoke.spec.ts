import { existsSync, readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Known accessibility issues accepted for now, each with a reason: { "rules": { "<axe-rule>": "why" } }.
// Keep this empty for new apps; ported sites may start with entries and fix them later.
const EXCEPTIONS_FILE = "tests/e2e/a11y-exceptions.json";
const exceptions: Record<string, string> = existsSync(EXCEPTIONS_FILE)
  ? (JSON.parse(readFileSync(EXCEPTIONS_FILE, "utf8")) as { rules: Record<string, string> }).rules
  : {};

// The page these checks open: your home page, or a public one when yours is behind a sign-in
// (E2E_HOME in project.mk, e.g. a 404 page). A 404 page's own status is the browser's console
// error, not the app's.
const HOME = process.env.E2E_HOME || "/";

test("health endpoint reports ok", async ({ request }) => {
  const res = await request.get("/health");
  expect(res.ok()).toBe(true);
  expect((await res.json()).status).toBe("ok");
});

test("home page loads without console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !(HOME !== "/" && m.text().includes("status of 404")))
      errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(HOME);
  await expect(page.getByRole("main")).toBeVisible();
  expect(errors).toEqual([]);
});

test("home page has no serious accessibility violations", async ({ page }) => {
  await page.goto(HOME);
  await expect(page.getByRole("main")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => ["serious", "critical"].includes(v.impact ?? "") && !exceptions[v.id],
  );
  expect(serious.map((v) => v.id)).toEqual([]);
});
