import { test, expect, login, ADMIN_CODE } from "./_helpers";

test.describe("login", () => {
  test("rejects empty submission via disabled button", async ({ page }) => {
    await page.goto("/login");
    const button = page.getByRole("button", { name: /เข้าสู่ระบบ/ });
    await expect(button).toBeDisabled();
  });

  test("rejects bad credentials and stays on /login", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("รหัสพนักงาน").fill(ADMIN_CODE);
    await page.getByLabel("รหัสผ่าน").fill("wrong-password-x");
    await page.getByRole("button", { name: /เข้าสู่ระบบ/ }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("admin login succeeds and lands on /bulk-edit", async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/bulk-edit/);
    await expect(page.getByRole("button", { name: /ออกจากระบบ/ }).first()).toBeVisible();
  });
});
