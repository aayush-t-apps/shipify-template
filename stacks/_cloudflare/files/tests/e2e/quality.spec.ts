import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";

// The automatic part of guides/quality-bar.md (in shipify). Accepted exceptions, each with a
// reason, go in tests/e2e/quality.json (app-owned), e.g.
// { "jsKb": { "value": 200, "reason": "charting library" },
//   "targets": { "a \"Logo\"": "2px short; fix tracked in CHANGELOG Unreleased" } }
const EXCEPTIONS_FILE = "tests/e2e/quality.json";
const exceptions = existsSync(EXCEPTIONS_FILE)
  ? (JSON.parse(readFileSync(EXCEPTIONS_FILE, "utf8")) as {
      jsKb?: { value: number; reason: string };
      targets?: Record<string, string>;
    })
  : {};
const JS_BUDGET_KB = exceptions.jsKb?.value ?? {{JS_BUDGET_KB}};
const allowedTargets = new Set(Object.keys(exceptions.targets ?? {}));

test.describe("quality bar", () => {
  test("phone at 360px has no horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/");
    await expect(page.locator("main")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "page scrolls sideways at 360px").toBeLessThanOrEqual(0);
  });

  test("tap targets are at least 24×24px (WCAG 2.5.8)", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/");
    await expect(page.locator("main")).toBeVisible();
    const small = await page.evaluate(() => {
      // Links inside running text are exempt (WCAG allows inline targets).
      const inline = (el: Element) => Boolean(el.closest("p, li, td, label, figcaption"));
      return [
        ...document.querySelectorAll("button, a[href], input, select, textarea, [role=button]"),
      ]
        .filter((el) => !(el.tagName === "A" && inline(el)))
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24))
        .map(({ el, r }) => ({
          label: `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 30)}"`,
          size: `${Math.round(r.width)}×${Math.round(r.height)}`,
        }));
    });
    const failing = small
      .filter((t) => !allowedTargets.has(t.label))
      .map((t) => `${t.label} ${t.size}`);
    expect(failing, "tap targets smaller than 24×24px").toEqual([]);
  });

  test(`initial JavaScript stays within ${JS_BUDGET_KB} KB compressed`, async ({
    page,
    request,
  }) => {
    const scripts: string[] = [];
    page.on("response", (r) => {
      if (r.request().resourceType() === "script") scripts.push(r.url());
    });
    await page.goto("/", { waitUntil: "load" });
    let bytes = 0;
    for (const url of scripts) bytes += gzipSync(await (await request.get(url)).body()).length;
    const kb = Math.round(bytes / 1024);
    expect(kb, `initial JS is ${kb} KB gzip (budget ${JS_BUDGET_KB} KB)`).toBeLessThanOrEqual(
      JS_BUDGET_KB,
    );
  });
});
