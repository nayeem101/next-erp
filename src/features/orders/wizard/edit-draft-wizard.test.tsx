import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { EditDraftWizard } from "./edit-draft-wizard";

import type { ActiveCustomerOption, ActiveProductOption } from "../selectors";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  updateDraftOrderAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/features/orders/actions", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  updateDraftOrderAction: mocks.updateDraftOrderAction,
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
  {
    id: "c2",
    name: "Globex Supply",
    companyName: null,
    email: "ops@globex.com",
    phone: null,
    city: "Shelbyville",
    region: null,
    countryCode: "US",
  },
];

const products: ActiveProductOption[] = [
  {
    id: "p1",
    sku: "SKU-1",
    name: "Cordless Drill",
    unitPriceCents: 12999,
    stockOnHand: 50,
  },
];

const draft = {
  orderId: "order-7",
  version: 3,
  customerId: "c1",
  customerName: "Acme Retail",
  notes: "Original note",
  lines: [
    {
      productId: "p1",
      sku: "SKU-1",
      name: "Cordless Drill",
      unitPriceCents: 12999,
      quantity: 2,
    },
  ],
};

describe("edit draft wizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("hydrates the server draft into step one and submits ID plus version", async () => {
    const user = userEvent.setup();

    mocks.updateDraftOrderAction.mockResolvedValue({
      ok: true,
      data: { orderId: draft.orderId, version: 4, totalCents: 25998 },
    });

    render(
      <EditDraftWizard
        draft={draft}
        customerOptions={customers}
        productOptions={products}
      />,
    );

    // Hydrated customer is preselected; jump straight through.
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));

    // Hydrated line and notes render on review.
    expect(screen.getAllByText(/×/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Notes for this order/)).toHaveValue(
      "Original note",
    );

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(mocks.updateDraftOrderAction).toHaveBeenCalledWith({
      orderId: "order-7",
      version: 3,
      customerId: "c1",
      lines: [{ productId: "p1", quantity: 2 }],
      notes: "Original note",
    });

    await vi.waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith("/sales/orders/order-7");
    });
  });

  test("local edits flow into the submitted payload", async () => {
    const user = userEvent.setup();

    mocks.updateDraftOrderAction.mockResolvedValue({
      ok: true,
      data: { orderId: draft.orderId, version: 4, totalCents: 12999 },
    });

    render(
      <EditDraftWizard
        draft={draft}
        customerOptions={customers}
        productOptions={products}
      />,
    );

    // Switch the customer to Globex.
    await user.click(screen.getByRole("combobox"));
    await user.type(screen.getByRole("combobox"), "globex");
    await user.keyboard("{Enter}");

    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));

    const notes = screen.getByLabelText(/Notes for this order/);
    await user.clear(notes);
    await user.type(notes, "Updated note");

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(mocks.updateDraftOrderAction).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "c2", notes: "Updated note" }),
    );
  });

  test("a version conflict surfaces its message and preserves every local input", async () => {
    const user = userEvent.setup();

    mocks.updateDraftOrderAction.mockResolvedValue({
      ok: false,
      error: {
        code: "CONFLICT",
        message:
          "This order changed while you were editing it. Reload and try again.",
      },
    });

    render(
      <EditDraftWizard
        draft={draft}
        customerOptions={customers}
        productOptions={products}
      />,
    );

    // Edit notes before saving so we can prove they survive the conflict.
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));

    const notes = screen.getByLabelText(/Notes for this order/);
    await user.clear(notes);
    await user.type(notes, "Do not lose this");

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "This order changed while you were editing it.",
    );

    // Nothing navigated and nothing was lost — retry stays possible.
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Notes for this order/)).toHaveValue(
      "Do not lose this",
    );
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });
});
