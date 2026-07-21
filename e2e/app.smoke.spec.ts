import { expect, test } from "@playwright/test";

test("serves the application shell", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("NextERP");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "To get started, edit the page.tsx file.",
    }),
  ).toBeVisible();
});
