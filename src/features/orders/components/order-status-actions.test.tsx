import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { OrderStatusActions } from "./order-status-actions";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  confirmOrderAction: vi.fn(),
  fulfillOrderAction: vi.fn(),
  cancelOrderAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/features/orders/actions", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  confirmOrderAction: mocks.confirmOrderAction,
  fulfillOrderAction: mocks.fulfillOrderAction,
  cancelOrderAction: mocks.cancelOrderAction,
}));

describe("order status actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("terminal orders render no controls for anyone", () => {
    const { unmount } = render(
      <OrderStatusActions
        orderId="o1"
        status="fulfilled"
        version={3}
        currentRoles={["admin"]}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    unmount();

    render(
      <OrderStatusActions
        orderId="o1"
        status="cancelled"
        version={4}
        currentRoles={["sales"]}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("confirm dialog names side effects and submits orderId plus version", async () => {
    const user = userEvent.setup();

    mocks.confirmOrderAction.mockResolvedValue({
      ok: true,
      data: {
        orderId: "o1",
        orderNumber: "SO-000001",
        version: 2,
        invoiceId: "i1",
        invoiceNumber: "INV-000001",
        totalCents: 1000,
      },
    });

    render(
      <OrderStatusActions
        orderId="o1"
        status="draft"
        version={1}
        currentRoles={["sales"]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Confirm order" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Stock is deducted");
    expect(dialog.textContent).toContain("invoice is issued");
    expect(dialog.textContent).toContain("sale journal");

    await user.click(screen.getByRole("button", { name: "Confirm order" }));

    expect(mocks.confirmOrderAction).toHaveBeenCalledWith({
      orderId: "o1",
      version: 1,
    });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  test("typed conflict keeps the dialog open with the error visible", async () => {
    const user = userEvent.setup();

    mocks.confirmOrderAction.mockResolvedValue({
      ok: false,
      error: {
        code: "CONFLICT",
        message:
          "This order changed while you were working. Reload and try again.",
      },
    });

    render(
      <OrderStatusActions
        orderId="o1"
        status="draft"
        version={1}
        currentRoles={["admin"]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Confirm order" }));
    await user.click(screen.getByRole("button", { name: "Confirm order" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "This order changed while you were working.",
    );
    // Dialog stayed open for recovery; no refresh happened.
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  test("cancelling a confirmed order requires a reason and warns about reversal", async () => {
    const user = userEvent.setup();

    mocks.cancelOrderAction.mockResolvedValue({
      ok: true,
      data: {
        orderId: "o1",
        version: 3,
        status: "cancelled",
        reversed: true,
      },
    });

    render(
      <OrderStatusActions
        orderId="o1"
        status="confirmed"
        version={2}
        currentRoles={["admin"]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Cancel order" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("invoice is voided");
    expect(dialog.textContent).toContain("reversal journal");

    // Reason is mandatory.
    await user.click(screen.getByRole("button", { name: "Cancel order" }));
    expect(mocks.cancelOrderAction).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/Reason/), "Duplicate entry.");
    await user.click(screen.getByRole("button", { name: "Cancel order" }));

    expect(mocks.cancelOrderAction).toHaveBeenCalledWith({
      orderId: "o1",
      version: 2,
      reason: "Duplicate entry.",
    });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  test("inventory sees fulfillment only; sales sees authoring only", () => {
    const inventory = render(
      <OrderStatusActions
        orderId="o1"
        status="confirmed"
        version={2}
        currentRoles={["inventory"]}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Mark fulfilled" }),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Cancel order" })).toBeNull();
    inventory.unmount();

    render(
      <OrderStatusActions
        orderId="o1"
        status="confirmed"
        version={2}
        currentRoles={["sales"]}
      />,
    );

    expect(screen.getByRole("button", { name: "Cancel order" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Mark fulfilled" })).toBeNull();

    void mocks.fulfillOrderAction;
  });
});
