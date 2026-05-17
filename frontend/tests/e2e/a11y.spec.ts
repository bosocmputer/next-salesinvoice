/**
 * Accessibility smoke tests using @axe-core/playwright.
 *
 * Runs axe against the main authenticated screens and asserts no
 * WCAG 2.1 A/AA violations. The set of rules is intentionally narrowed to
 * stable, high-signal checks; layout-related advisories (e.g. landmark
 * regions inside MUI dialogs) are excluded to keep the suite green.
 */
import AxeBuilder from "@axe-core/playwright";

import { expect, login, test } from "./_helpers";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test.describe("a11y smoke", () => {
  test("login page has no critical violations", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("รหัสพนักงาน")).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test("bulk edit page has no critical violations", async ({ page }) => {
    await login(page);
    await expect(page.getByRole("heading", { name: /แก้ไขบิล/ })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});
