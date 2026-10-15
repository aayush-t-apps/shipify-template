import { expect, test } from "@playwright/test";

test("shows the app name", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("{{APP_NAME}}");
});
