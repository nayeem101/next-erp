import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { readE2ETestEnvironment } from "./environment";

const environment = readE2ETestEnvironment();

test.skip(
  environment.inventory === undefined,
  "Set E2E_INVENTORY_EMAIL and E2E_INVENTORY_PASSWORD against a seeded project.",
);

const inventory = environment.inventory ?? { email: "", password: "" };

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");

  await page.getByLabel("Email").fill(inventory.email);
  await page
    .getByRole("textbox", { name: "Password" })
    .fill(inventory.password);
  await page.getByRole("button", { name: /^Sign in$/i }).click();

  await page.waitForURL(/\/(dashboard|inventory|sales)/);
}

/** Ensures at least one confirmed order exists (admin-seeded demo data). */
async function ensureDemoData(request: APIRequestContext): Promise<boolean> {
  const response = await request.post("/api/demo-seed");

  return response.ok();
}

test.describe("inventory browser flow", () => {
  test("fulfills a confirmed order without any revenue visibility and is denied invoice/ledger access", async ({
    page,
    request,
  }) => {
    const seeded = await ensureDemoData(request);
    expect(seeded).toBe(true);

    await signIn(page);

    // Orders module is visible to Inventory.
    await page.goto("/sales/orders");
    await expect(page.getByRole("table")).toBeVisible();

    // Open the first confirmed order.
    await page.goto("/sales/orders?status=confirmed");
    await page.getByRole("link", { name: /^SO-/ }).first().click();

    await page.waitForURL(/\/sales\/orders\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Confirmed").first()).toBeVisible();

    // Operational projection: quantities are visible...
    await expect(
      page.getByRole("table").or(page.getByRole("list")),
    ).toBeVisible();

    // ...but no money anywhere on the page.
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/\$\s?\d/);
    expect(bodyText).toContain("Not visible");

    // Fulfill through the explicit dialog.
    await page.getByRole("button", { name: "Mark fulfilled" }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "No stock or ledger changes",
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Mark fulfilled" })
      .click();

    await expect(page.getByText("Fulfilled").first()).toBeVisible();

    // RBAC smoke: forbidden routes render the no-access state.
    for (const path of ["/accounting/invoices", "/accounting/ledger"]) {
      await page.goto(path);
      await expect(
        page
          .getByText(/You do not have access|don.t have access|Forbidden/i)
          .first(),
      ).toBeVisible();
    }

    // Direct unauthorized submission: PDF endpoint refuses the session.
    const anyInvoice = await request.get("/accounting/invoices");
    void anyInvoice;

    // Grab an arbitrary invoice id from the orders we know exist via the
    // detail page is impossible without money access — hit the endpoint
    // with a well-formed id and expect 403 before existence checks.
    const pdfResponse = await request.get(
      "/api/invoices/00000000-0000-4000-8000-00000000dd01/pdf",
    );
    expect(pdfResponse.status()).toBe(403);
  });
});
