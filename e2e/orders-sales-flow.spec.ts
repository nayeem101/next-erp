import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { readE2ETestEnvironment } from "./environment";

const environment = readE2ETestEnvironment();

test.skip(
  environment.sales === undefined,
  "Set E2E_SALES_EMAIL and E2E_SALES_PASSWORD against a seeded project.",
);

const sales = environment.sales ?? { email: "", password: "" };

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");

  await page.getByLabel("Email").fill(sales.email);
  await page.getByRole("textbox", { name: "Password" }).fill(sales.password);
  await page.getByRole("button", { name: /^Sign in$/i }).click();

  await page.waitForURL(/\/(dashboard|inventory|customers)/);
}

async function bootstrapDemoData(request: APIRequestContext): Promise<void> {
  const response = await request.post("/api/demo-seed");

  // Idempotent: 200 whether or not data already existed.
  expect(response.ok()).toBe(true);
}

const uniqueSuffix = Date.now().toString().slice(-6);

test.describe("sales browser flow", () => {
  test("creates a customer, builds a multi-line order, confirms it, and opens the invoice", async ({
    page,
    request,
  }) => {
    await signIn(page);
    await bootstrapDemoData(request);

    // 1. Create a fresh customer through the production form.
    await page.goto("/customers/new");

    await page.getByLabel("Name").fill(`Flow Buyer ${uniqueSuffix}`);
    await page.getByLabel("Email").fill(`flow.${uniqueSuffix}@example.com`);
    await page.getByLabel("Address line 1").fill("9 Test Way");
    await page.getByLabel("City").fill("Springfield");
    await page.getByLabel("Postal code").fill("62704");
    await page.getByLabel("Country code").fill("US");
    await page.getByRole("button", { name: /^Create customer$/i }).click();

    await expect(page).toHaveURL(/\/customers\//);
    await expect(page.getByText(/Flow Buyer/)).toBeVisible();

    // 2. Build a two-line draft in the wizard.
    await page.goto("/sales/orders/new");

    const combo = page.getByRole("combobox");
    await combo.click();
    await combo.fill("Flow Buyer");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("group", { name: /Selected customer: Flow Buyer/ }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Next" }).click();

    const productSelect = page.getByLabel("Product");
    await productSelect.selectOption({ index: 1 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Add" })).toBeDisabled();
    await productSelect.selectOption({ index: 2 });
    await page.keyboard.press("Enter");

    // Two distinct rows are present.
    await expect(page.getByRole("table")).toContainText("×");

    const firstQuantity = page.getByLabel(/Quantity for/).first();
    await firstQuantity.fill("2");
    await firstQuantity.blur();

    await page.getByRole("button", { name: "Next" }).click();

    // 3. Review shows an estimated total; save the draft.
    await expect(page.getByText("Estimated total")).toBeVisible();
    await page
      .getByLabel(/Notes for this order/)
      .fill(`Browser flow ${uniqueSuffix}`);
    await page.getByRole("button", { name: "Save draft" }).click();

    await page.waitForURL(/\/sales\/orders\/[0-9a-f-]{36}$/);

    // 4. Confirm through the side-effect dialog.
    await page.getByRole("button", { name: "Confirm order" }).click();
    await expect(page.getByRole("dialog")).toContainText("Stock is deducted");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm order" })
      .click();

    // Stock-safe success: badge flips and edit path disappears.
    await expect(page.getByText("Confirmed")).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit draft" })).toHaveCount(0);

    // 5. The invoice register lists the new invoice; open it.
    await page.goto("/accounting/invoices");
    await expect(page.getByRole("table")).toBeVisible();

    await page.goto("/accounting/invoices?status=issued");
    const newestInvoice = page.getByRole("link", { name: /^INV-/ }).first();
    await newestInvoice.click();

    await expect(page).toHaveURL(/\/accounting\/invoices\//);
    await expect(page.getByText("Total due (USD)")).toBeVisible();

    // 6. PDF download responds as an authenticated attachment.
    const pdfResponse = await page.request.get(
      page.url().replace(/\/accounting\/invoices\/.*/, "") +
        `/api/invoices/${page.url().split("/").pop() ?? ""}/pdf`,
    );

    expect(pdfResponse.status()).toBe(200);
    expect(pdfResponse.headers()["content-type"]).toBe("application/pdf");
    expect(pdfResponse.headers()["content-disposition"]).toMatch(
      /^attachment; filename="INV-\d{6}\.pdf"$/,
    );

    const body = await pdfResponse.body();
    expect(body.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
