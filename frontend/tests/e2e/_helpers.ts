import { test, expect, type Page } from "@playwright/test";

const ADMIN_CODE = process.env.E2E_ADMIN_CODE || "EMP001";
const ADMIN_PASS = process.env.E2E_ADMIN_PASS || "1234";

export async function login(page: Page, code = ADMIN_CODE, password = ADMIN_PASS) {
  await page.goto("/login");
  await page.getByLabel("รหัสพนักงาน").fill(code);
  await page.getByLabel("รหัสผ่าน").fill(password);
  await page.getByRole("button", { name: /เข้าสู่ระบบ/ }).click();
  await expect(page).toHaveURL(/\/bulk-edit/, { timeout: 15_000 });
}

export { expect, test, ADMIN_CODE, ADMIN_PASS };
