import { test, expect } from "@playwright/test";

const SUPER_USER = {
  email: "super@vilcami.com",
  password: "Super123!",
};

test.describe("Authentication", () => {
  test("login page shows VILCAMI branding", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("h1")).toHaveText("VILCAMI");
    await expect(page.locator("text=Industrial IoT Monitor")).toBeVisible();
  });

  test("can log in with valid credentials and redirects to dashboard", async ({
    page,
  }) => {
    // Clear any existing session
    await page.goto("/login");
    await page.evaluate(() => localStorage.clear());

    // Fill in credentials
    await page.fill('input[type="email"]', SUPER_USER.email);
    await page.fill('input[type="password"]', SUPER_USER.password);
    await page.click('button[type="submit"]');

    // Should redirect to dashboard
    await expect(page).toHaveURL("/");
    await expect(page.locator("header")).toBeVisible();
  });

  test("login form shows error for invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.evaluate(() => localStorage.clear());

    await page.fill('input[type="email"]', "noexiste@vilcami.com");
    await page.fill('input[type="password"]', "mala");
    await page.click('button[type="submit"]');

    await expect(page.locator(".bg-danger\\/10")).toBeVisible();
  });

  test("redirects to login when accessing protected route unauthenticated", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/");
    await expect(page).toHaveURL("/login");
  });
});

test.describe("Authenticated session", () => {
  test.beforeEach(async ({ page }) => {
    // Log in via API to set session
    await page.goto("/login");
    await page.evaluate(() => localStorage.clear());
    await page.fill('input[type="email"]', SUPER_USER.email);
    await page.fill('input[type="password"]', SUPER_USER.password);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL("/");
  });

  test("dashboard shows devices widget after login", async ({ page }) => {
    await expect(page.locator("header")).toBeVisible();
  });

  test("can navigate to all sections from sidebar", async ({ page }) => {
    const navItems = ["Dashboard", "Dispositivos", "Alertas", "Billing"];
    for (const item of navItems) {
      await page.click(`text=${item}`);
      await expect(page.locator("header")).toBeVisible();
      // Each page should have a header title
      await expect(page.locator("header h2")).toBeVisible();
    }
  });

  test("can log out and return to login", async ({ page }) => {
    // Sidebar has a Cerrar sesion button at the bottom
    await page.click("aside button:has-text('Cerrar sesion')");
    // Should redirect to login
    await expect(page).toHaveURL("/login");
  });
});

test.describe("Members page (admin-only)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.evaluate(() => localStorage.clear());
    await page.fill('input[type="email"]', SUPER_USER.email);
    await page.fill('input[type="password"]', SUPER_USER.password);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL("/");
  });

  test("super admin can access members page", async ({ page }) => {
    await page.goto("/members");
    await expect(page).toHaveURL(/\/members/);
  });
});
