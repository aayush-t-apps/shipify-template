import { expect, test } from "@playwright/test";

test("result updates as you type", async ({ page }) => {
  await page.goto("/");
  const input = page.getByLabel("Input");
  await input.fill("one two three");
  await expect(page.getByTestId("words")).toHaveText("3 words");
});
