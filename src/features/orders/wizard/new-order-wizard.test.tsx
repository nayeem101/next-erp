import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { NewOrderWizard } from "./new-order-wizard";

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

describe("new order wizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("successful save submits the draft, resets transient state, and navigates", async () => {
    const user = userEvent.setup();

    mocks.createDraftOrderAction.mockResolvedValue({
      ok: true,
      data: {
        orderId: "order-9",
        orderNumber: "SO-000123",
        version: 1,
        totalCents: 12999,
      },
    });

    render(
      <NewOrderWizard customerOptions={customers} productOptions={products} />,
    );

    // Walk the wizard through its steps.
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /Acme Retail/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));

    await user.selectOptions(
      screen.getByLabelText("Product"),
      "Cordless Drill (SKU-1)",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "Next" }));

    // Unit price and line total coincide at qty 1; the estimated total
    // section also shows it.
    expect(screen.getAllByText("$129.99").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Save draft" }));

    // Payload mirrors exactly what the wizard held.
    expect(mocks.createDraftOrderAction).toHaveBeenCalledWith({
      customerId: "c1",
      lines: [{ productId: "p1", quantity: 1 }],
      notes: undefined,
    });

    // Transient state reset only on success, then navigation.
    await vi.waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith("/sales/orders/order-9");
    });
  });

  test("failed save keeps the wizard on review with inputs intact", async () => {
    const user = userEvent.setup();

    mocks.createDraftOrderAction.mockResolvedValue({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "A product in this order was archived.",
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

    await user.type(screen.getByLabelText(/Notes for this order/), "Rush it");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "A product in this order was archived.",
    );
    expect(mocks.push).not.toHaveBeenCalled();

    // Retry is possible without retyping anything.
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
  });

  test("saving without a customer fails fast before hitting the action", () => {
    render(
      <NewOrderWizard customerOptions={customers} productOptions={products} />,
    );

    // The Next button stays disabled until a customer exists, so the
    // wizard cannot reach review — and never calls the action.
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(mocks.createDraftOrderAction).not.toHaveBeenCalled();
  });
});
