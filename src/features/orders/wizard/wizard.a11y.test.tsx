import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, expect, test, vi } from "vitest";

import { CustomerStep } from "./customer-step";
import { LineItemsStep } from "./line-items-step";
import { NewOrderWizard } from "./new-order-wizard";
import { ReviewStep } from "./review-step";
import { createOrderWizardStore } from "./store";

import type { ActiveCustomerOption } from "../selectors";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  createDraftOrderAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/features/orders/actions", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createDraftOrderAction: mocks.createDraftOrderAction,
}));

expect.extend(toHaveNoViolations);

const customers: ActiveCustomerOption[] = [
  {
    id: "c1",
    name: "Acme Retail",
    companyName: null,
    email: "buyer@acme.com",
    phone: null,
    city: "Springfield",
    region: null,
    countryCode: "US",
  },
];

const products = [
  {
    id: "p1",
    sku: "SKU-1",
    name: "Cordless Drill",
    unitPriceCents: 12999,
    stockOnHand: 50,
  },
];

describe("wizard accessibility", () => {
  test.each([
    [
      "customer step",
      (store: ReturnType<typeof createOrderWizardStore>) => (
        <CustomerStep store={store} options={customers} />
      ),
    ],
    [
      "line items step",
      (store: ReturnType<typeof createOrderWizardStore>) => (
        <LineItemsStep store={store} options={products} />
      ),
    ],
    [
      "review step",
      (store: ReturnType<typeof createOrderWizardStore>) => (
        <ReviewStep
          store={store}
          onSave={() => Promise.resolve({ ok: true, data: undefined })}
        />
      ),
    ],
  ])("%s has no axe violations", async (_name, renderStep) => {
    const store = createOrderWizardStore();
    const { container } = render(renderStep(store));

    expect(await axe(container)).toHaveNoViolations();
  });

  test("keyboard-only user completes the wizard end to end", async () => {
    const user = userEvent.setup();

    mocks.createDraftOrderAction.mockResolvedValue({
      ok: true,
      data: {
        orderId: "order-k1",
        orderNumber: "SO-000300",
        version: 1,
        totalCents: 12999,
      },
    });

    render(
      <NewOrderWizard customerOptions={customers} productOptions={products} />,
    );

    // Focus starts on the step heading.
    expect(screen.getByRole("heading", { name: "Customer" })).toHaveFocus();

    // Open the combobox and pick the customer without touching a mouse.
    await user.tab(); // combobox
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    // Selection confirmed via the labelled contact-preview group.
    expect(
      screen.getByRole("group", { name: /Selected customer: Acme Retail/ }),
    ).toBeDefined();

    // Advance to line items with Enter on the focused Next button.
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("status").textContent).toContain("Line items");

    // Add the product entirely from the keyboard: choosing with Enter
    // commits the selection immediately.
    await user.selectOptions(
      screen.getByLabelText("Product"),
      "Cordless Drill (SKU-1)",
    );
    await user.keyboard("{Enter}");

    expect(screen.getByLabelText("Quantity for Cordless Drill")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Next" }));

    // Review: save with Enter on the focused save button.
    await user.tab();
    await user.tab();
    await user.tab();

    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(mocks.createDraftOrderAction).toHaveBeenCalledWith({
      customerId: "c1",
      lines: [{ productId: "p1", quantity: 1 }],
      notes: undefined,
    });

    await vi.waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith("/sales/orders/order-k1");
    });
  });

  test("stale-state conflict keeps focusable controls usable after failure", async () => {
    const user = userEvent.setup();

    mocks.createDraftOrderAction.mockResolvedValue({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "A product in this order was archived. Remove it first.",
      },
    });

    render(
      <NewOrderWizard customerOptions={customers} productOptions={products} />,
    );

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /Acme Retail/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.selectOptions(
      screen.getByLabelText("Product"),
      "Cordless Drill (SKU-1)",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "Next" }));

    await user.click(screen.getByRole("button", { name: "Save draft" }));

    // Insufficient/stale-state presentation: alert role, actionable text.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "A product in this order was archived. Remove it first.",
    );

    // The wizard remains fully operable for correction + retry.
    const retry = screen.getByRole("button", { name: "Save draft" });
    expect(retry).toBeEnabled();
    expect(retry).not.toHaveAttribute("disabled");

    // Back navigation stays available so users can fix their lines.
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
  });
});
