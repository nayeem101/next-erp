import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { StockAdjustmentDialog } from "@/features/products/components/stock-adjustment-dialog";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  adjustStockAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock("@/features/products/actions", () => ({
  adjustStockAction: mocks.adjustStockAction,
}));

function renderDialog(overrides?: { currentStock?: number }) {
  return render(
    <StockAdjustmentDialog
      productId="00000000-0000-4000-8000-000000000001"
      productName="Cordless Drill"
      currentStock={overrides?.currentStock ?? 40}
      open
      onOpenChange={vi.fn()}
    />,
  );
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    mock.mockReset();
  }
});

describe("StockAdjustmentDialog", () => {
  test("shows the current balance in the description", () => {
    renderDialog({ currentStock: 33 });

    const marker = screen.getByText("33", { selector: "[data-slot]" });

    expect(marker).toBeInTheDocument();
  });

  test("blocks zero deltas and blank reasons with inline errors", async () => {
    const user = userEvent.setup();

    renderDialog();

    await user.type(screen.getByLabelText("Quantity change"), "0");
    await user.click(screen.getByRole("button", { name: /apply adjustment/i }));

    expect(await screen.findAllByRole("alert")).not.toHaveLength(0);
    expect(mocks.adjustStockAction).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Quantity change"));
    await user.type(screen.getByLabelText(/reason/i), "   ");

    // Whitespace-only reasons still fail validation.
    expect(mocks.adjustStockAction).not.toHaveBeenCalled();
  });

  test("submits parsed integer delta and trimmed reason on success", async () => {
    const user = userEvent.setup();

    mocks.adjustStockAction.mockResolvedValue({
      ok: true,
      data: {
        productId: "00000000-0000-4000-8000-000000000001",
        stockOnHand: 45,
      },
    });

    renderDialog({ currentStock: 40 });

    await user.type(screen.getByLabelText("Quantity change"), "+5");
    await user.type(screen.getByLabelText(/reason/i), "Cycle count correction");

    await user.click(screen.getByRole("button", { name: /apply adjustment/i }));

    await waitFor(() => {
      expect(mocks.adjustStockAction).toHaveBeenCalledWith({
        productId: "00000000-0000-4000-8000-000000000001",
        quantityDelta: 5,
        reason: "Cycle count correction",
      });
    });
    await waitFor(() => {
      expect(mocks.refresh).toHaveBeenCalled();
    });
  });

  test("insufficient-stock failures keep the dialog open and echo the balance", async () => {
    const user = userEvent.setup();

    mocks.adjustStockAction.mockResolvedValue({
      ok: false,
      error: {
        code: "INSUFFICIENT_STOCK",
        message:
          "Adjustment rejected: the resulting balance would be negative.",
      },
    });

    renderDialog({ currentStock: 12 });

    await user.type(screen.getByLabelText("Quantity change"), "-50");
    await user.type(screen.getByLabelText(/reason/i), "Shrinkage write-off");

    await user.click(screen.getByRole("button", { name: /apply adjustment/i }));

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(/negative/i);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Draft survives so the operator can correct it.
    expect(screen.getByLabelText("Quantity change")).toHaveValue("-50");
    // The live balance is still visible for correction.
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
