import { expect, test, type Page } from "@playwright/test";

import { readE2ETestEnvironment } from "./environment";

const environment = readE2ETestEnvironment();

test.describe("unauthenticated access control", () => {
  test("sends anonymous users from protected routes to login with a safe next", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
    await expect(
      page.getByRole("heading", { name: "Sign in to NextERP" }),
    ).toBeVisible();
  });

  test("encodes deep-link targets into the next parameter", async ({
    page,
  }) => {
    await page.goto("/inventory/products?page=2");

    await expect(page).toHaveURL(
      /\/login\?next=%2Finventory%2Fproducts%3Fpage%3D2$/,
    );
  });

  test("shows the generic invalid-credentials message", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel("Email").fill("nobody@example.com");
    await page
      .getByRole("textbox", { name: "Password" })
      .fill("definitely-wrong-password");
    await page.getByRole("button", { name: /^Sign in$/i }).click();

    // Scope past Next.js's route announcer, which also carries role="alert".
    const alert = page.locator('[data-slot="alert"]');

    await expect(alert).toBeVisible();
    await expect(alert).toContainText(
      "Incorrect email or password. Please try again.",
    );
    // Input must be preserved for correction.
    await expect(page.getByLabel("Email")).toHaveValue("nobody@example.com");
  });
});

test.describe("authenticated flows", () => {
  test.skip(
    environment.admin === undefined,
    "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD against a seeded project.",
  );

  const admin = environment.admin ?? {
    email: "",
    password: "",
  };

  async function signIn(page: Page): Promise<void> {
    await page.goto("/login");

    await page.getByLabel("Email").fill(admin.email);
    await page.getByRole("textbox", { name: "Password" }).fill(admin.password);
    await page.getByRole("button", { name: /^Sign in$/i }).click();

    await page.waitForURL(/\/(dashboard|inventory)/);
  }

  test("logs the seeded admin in and reaches the dashboard", async ({
    page,
  }) => {
    await signIn(page);

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(
      page.getByRole("navigation", { name: "Primary" }),
    ).toContainText("Administration");

    // The account menu exposes identity and sign-out.
    await page.getByRole("button", { name: /account menu/i }).click();
    await expect(page.getByText(admin.email)).toBeVisible();
  });

  test("returns to the original target after signing in through next", async ({
    page,
  }) => {
    await page.goto("/admin/users");

    await expect(page).toHaveURL(/\/login/);

    await page.getByLabel("Email").fill(admin.email);
    await page.getByRole("textbox", { name: "Password" }).fill(admin.password);
    await page.getByRole("button", { name: /^Sign in$/i }).click();

    await page.waitForURL(/\/admin\/users/);
    await expect(page).toHaveURL(/\/admin\/users/);
  });

  test("signing out returns to login and re-protects routes", async ({
    page,
  }) => {
    await signIn(page);

    await page.getByRole("button", { name: /account menu/i }).click();
    await page.getByRole("menuitem", { name: /sign out/i }).click();

    await page.waitForURL(/\/login$/);

    await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  });

  test("bounces authenticated users away from the login page", async ({
    page,
  }) => {
    await signIn(page);

    await page.goto("/login");

    await expect(page).toHaveURL(/\/dashboard/);
  });
});
