import { test, expect, login } from "./_helpers";

test.describe("bulk-edit shortcuts and toast", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("Ctrl+K focuses search input", async ({ page }) => {
    const search = page.getByPlaceholder(/เลขบิล/);
    await expect(search).toBeVisible();
    await page.keyboard.press("Control+K");
    await expect(search).toBeFocused();
  });

  test("'/' focuses search when not in input", async ({ page }) => {
    const search = page.getByPlaceholder(/เลขบิล/);
    await expect(search).toBeVisible();
    // Click on the page body first to ensure focus is outside any input
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("/");
    await expect(search).toBeFocused();
  });

  test("typing in search updates the field", async ({ page }) => {
    const search = page.getByPlaceholder(/เลขบิล/);
    await search.click();
    await search.fill("INV-TEST-123");
    await expect(search).toHaveValue("INV-TEST-123");
  });
});
