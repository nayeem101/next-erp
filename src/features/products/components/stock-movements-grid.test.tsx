import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { StockMovementsGrid } from "@/features/products/components/stock-movements-grid";
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

const productOptions = [
  {
    id: "00000000-0000-4000-8000-00000000b001",
    label: "SKU-1000 — Cordless Drill",
  },
  {
    id: "00000000-0000-4000-8000-00000000b002",
    label: "SKU-2000 — Garden Hose",
  },
];

const actorOptions = [
  { id: "00000000-0000-4000-8000-00000000c001", label: "Alex Admin" },
  { id: "00000000-0000-4000-8000-00000000c002", label: "Sam Stocker" },
];

function row(overrides: Partial<StockMovementRow>): StockMovementRow {
  return {
    id: overrides.id ?? "00000000-0000-4000-8000-00000000a001",
    productId: "00000000-0000-4000-8000-00000000b001",
    productSku: overrides.productSku ?? "SKU-1000",
    productName: overrides.productName ?? "Cordless Drill",
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

function makePage(rows: StockMovementRow[]): StockMovementPage {
  return { rows, total: rows.length, page: 1, pageSize: 20, totalPages: 1 };
}

beforeEach(() => {
  mocks.push.mockReset();
});

describe("StockMovementsGrid filters", () => {
  test("type segments expose canonical hrefs and mark the current one", () => {
    render(
      <StockMovementsGrid
        page={makePage([row({})])}
        productOptions={productOptions}
        actorOptions={actorOptions}
        urlValues={{ type: "adjustment", page: 1, pageSize: 20 }}
      />,
    );

    expect(screen.getByRole("link", { name: "Adjustment" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("link", { name: "All" })).toHaveAttribute(
      "href",
      "/inventory/stock-movements",
    );
    expect(screen.getByRole("link", { name: "Sale" })).toHaveAttribute(
      "href",
      "/inventory/stock-movements?type=sale",
    );
  });

  test("product selection navigates to the scoped view", async () => {
    const user = userEvent.setup();

    render(
      <StockMovementsGrid
        page={makePage([row({})])}
        productOptions={productOptions}
        actorOptions={actorOptions}
        urlValues={{ page: 1, pageSize: 20 }}
      />,
    );

    const input = screen.getByRole("combobox", { name: "Filter by product" });

    await user.click(input);
    await user.type(input, "Hose");
    await user.click(
      await screen.findByRole("option", { name: /garden hose/i }),
    );

    expect(mocks.push).toHaveBeenCalledWith(
      "/inventory/stock-movements?productId=00000000-0000-4000-8000-00000000b002",
    );
  });

  test("date inputs navigate immediately on change", async () => {
    const user = userEvent.setup();

    render(
      <StockMovementsGrid
        page={makePage([row({})])}
        productOptions={productOptions}
        actorOptions={actorOptions}
        urlValues={{ from: "2026-08-01", page: 1, pageSize: 20 }}
      />,
    );

    const toInput = screen.getByLabelText("To");

    await user.type(toInput, "2026-08-31");

    const lastCall = mocks.push.mock.calls.at(-1)?.[0] as string;

    expect(lastCall).toContain("from=2026-08-01");
    expect(lastCall).toContain("to=");
  });

  test("order-number filter debounces before navigating", async () => {
    render(
      <StockMovementsGrid
        page={makePage([row({})])}
        productOptions={productOptions}
        actorOptions={actorOptions}
        urlValues={{ page: 1, pageSize: 20 }}
      />,
    );

    const user = userEvent.setup();

    const orderInput = screen.getByLabelText("Order #");

    await user.type(orderInput, "SO-");

    // One debounced navigation for the whole burst, not one per keystroke.
    await waitFor(
      () => {
        expect(mocks.push).toHaveBeenCalledTimes(1);
        expect(mocks.push).toHaveBeenCalledWith(
          "/inventory/stock-movements?orderNumber=SO-",
        );
      },
      { timeout: 1500 },
    );
  });

  test("renders the cross-product identity column linking to products", () => {
    render(
      <StockMovementsGrid
        page={makePage([
          row({}),
          row({
            id: "00000000-0000-4000-8000-00000000a002",
            productSku: "SKU-2000",
            productName: "Garden Hose",
          }),
        ])}
        productOptions={productOptions}
        actorOptions={actorOptions}
        urlValues={{ page: 1, pageSize: 20 }}
      />,
    );

    const table = screen.getByRole("table", { name: "Stock movements" });

    expect(table).toBeInTheDocument();

    const drillLink = screen.getByRole("link", { name: "SKU-1000" });

    expect(drillLink).toHaveAttribute(
      "href",
      "/inventory/products/00000000-0000-4000-8000-00000000b001",
    );
    expect(screen.getByText("Garden Hose")).toBeInTheDocument();
  });

  test("pagination navigates within the filtered scope", async () => {
    const user = userEvent.setup();

    render(
      <StockMovementsGrid
        page={{
          ...makePage([row({})]),
          total: 25,
          totalPages: 2,
        }}
        productOptions={productOptions}
        actorOptions={actorOptions}
        urlValues={{ type: "sale", page: 1, pageSize: 20 }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /go to page 2/i }));

    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith(
        "/inventory/stock-movements?page=2&type=sale",
      );
    });
  });
});
