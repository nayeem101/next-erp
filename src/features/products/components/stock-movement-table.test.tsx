import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { StockMovementTable } from "@/features/products/components/stock-movement-table";
import type {
  StockMovementPage,
  StockMovementRow,
} from "@/features/products/stock-movement-schemas";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

function row(overrides: Partial<StockMovementRow>): StockMovementRow {
  return {
    id: overrides.id ?? "00000000-0000-4000-8000-00000000a001",
    productId: "00000000-0000-4000-8000-00000000b001",
    productSku: "SKU-1000",
    productName: "Cordless Drill",
    type: overrides.type ?? "adjustment",
    quantityDelta: overrides.quantityDelta ?? 10,
    resultingStock: overrides.resultingStock ?? 45,
    reason: overrides.reason ?? "Cycle count correction",
    orderId: overrides.orderId ?? null,
    orderNumber: overrides.orderNumber ?? null,
    actorId: "00000000-0000-4000-8000-00000000c001",
    actorName: overrides.actorName ?? "Alex Admin",
    createdAt: overrides.createdAt ?? "2026-08-20T09:30:00.000Z",
  };
}

beforeEach(() => {
  mocks.push.mockReset();
});

describe("StockMovementTable", () => {
  test("renders append-only rows with signed deltas and order references", () => {
    const orderId = "00000000-0000-4000-8000-00000000d001";

    render(
      <StockMovementTable
        productId="00000000-0000-4000-8000-00000000b001"
        page={{
          rows: [
            row({}),
            row({
              id: "00000000-0000-4000-8000-00000000a002",
              type: "opening",
              quantityDelta: 40,
              resultingStock: 40,
              reason: "Opening balance",
              actorName: "Sam Stocker",
            }),
            row({
              id: "00000000-0000-4000-8000-00000000a003",
              type: "sale",
              quantityDelta: -3,
              resultingStock: 37,
              orderId,
              orderNumber: "SO-000042",
              reason: "Sale for order SO-000042",
            }),
          ],
          total: 3,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        }}
        urlValues={{ page: 1, pageSize: 20 }}
      />,
    );

    const table = screen.getByRole("table", { name: "Stock movements" });

    expect(within(table).getByText("Opening")).toBeInTheDocument();
    expect(within(table).getByText("Sale")).toBeInTheDocument();
    expect(within(table).getAllByText("Adjustment")).toHaveLength(1);
    expect(within(table).getByText("+40")).toBeInTheDocument();
    expect(within(table).getByText("-3")).toBeInTheDocument();

    const orderLink = within(table).getByRole("link", { name: "SO-000042" });

    expect(orderLink).toHaveAttribute("href", `/sales/orders/${orderId}`);
    // Non-order rows render an em-dash placeholder.
    expect(within(table).getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  test("shows the dedicated empty state when no movements exist", () => {
    const page: StockMovementPage = {
      rows: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    };

    render(
      <StockMovementTable
        productId="00000000-0000-4000-8000-00000000b001"
        page={page}
        urlValues={{ page: 1, pageSize: 20 }}
      />,
    );

    expect(
      screen.getByText(/no stock movements recorded/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  test("pagination is url-bound to the product scope", async () => {
    const user = userEvent.setup();

    render(
      <StockMovementTable
        productId="00000000-0000-4000-8000-00000000b001"
        page={{
          rows: [row({})],
          total: 25,
          page: 1,
          pageSize: 20,
          totalPages: 2,
        }}
        urlValues={{ page: 1, pageSize: 20 }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /go to page 2/i }));

    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith(
        "/inventory/products/00000000-0000-4000-8000-00000000b001?page=2",
      );
    });
  });
});
