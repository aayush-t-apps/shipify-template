import { expect, test } from "@playwright/test";

test("home page shows its title", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/.+/);
});
