import { render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { OrderDetail } from "./order-detail";

import type { OrderDetailView } from "../schemas";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const baseOrder: OrderDetailView = {
  id: "00000000-0000-4000-8000-000000000009",
  orderNumber: "SO-000201",
  status: "confirmed",
  version: 2,
  customerId: "c1",
  customerName: "Acme Retail",
  customerCompanyName: "Acme Holdings",
  customerEmail: "buyer@acme.com",
  totalCents: 30548,
  currencyCode: "USD",
  notes: "Deliver to dock B",
  cancellationReason: null,
  lines: [
    {
      id: "l1",
      productId: "p1",
      productSku: "SKU-1",
      productName: "Cordless Drill",
      quantity: 2,
      unitPriceCents: 12999,
      lineTotalCents: 25998,
    },
    {
      id: "l2",
      productId: "p2",
      productSku: "SKU-2",
      productName: "Garden Hose",
      quantity: 1,
      unitPriceCents: 4550,
      lineTotalCents: 4550,
    },
  ],
  creatorName: "Alex Sales",
  confirmedByName: "Alex Sales",
  fulfilledByName: null,
  cancelledByName: null,
  createdAt: "2026-08-20T10:00:00.000Z",
  confirmedAt: "2026-08-21T09:30:00.000Z",
  fulfilledAt: null,
  cancelledAt: null,
};

describe("order detail", () => {
  test("renders snapshot lines with totals, actors, and timeline", () => {
    render(<OrderDetail order={baseOrder} currentRoles={["admin"]} />);

    expect(screen.getByText("SO-000201")).toBeDefined();
    // Badge and timeline both mention the status; both must exist.
    expect(screen.getAllByText("Confirmed").length).toBeGreaterThan(0);

    const table = screen.getByRole("table");

    expect(within(table).getByText("Cordless Drill")).toBeDefined();
    expect(within(table).getByText("$259.98")).toBeDefined();

    // Grand total row.
    expect(within(table).getAllByText("$305.48").length).toBeGreaterThan(0);

    // Timeline shows actor attribution.
    const timeline = screen.getByRole("region", { name: "Lifecycle timeline" });
    expect(timeline.textContent).toContain("Alex Sales");
  });

  test("inventory projection hides money but keeps lines and quantities", () => {
    const projected: OrderDetailView = {
      ...baseOrder,
      totalCents: null,
      lines: baseOrder.lines.map((line) => ({ ...line })),
    };

    render(<OrderDetail order={projected} currentRoles={["inventory"]} />);

    // No money anywhere.
    expect(screen.queryByText("$259.98")).toBeNull();
    expect(screen.queryByText("$305.48")).toBeNull();
    expect(screen.getByText("Not visible")).toBeDefined();

    // Lines degrade to a list with quantities intact.
    const list = screen.getByRole("list");
    expect(within(list).getByText(/Garden Hose/)).toBeDefined();
    expect(list.textContent).toContain("× 2");
  });

  test("draft orders surface the edit slot for authoring roles only", () => {
    const draft: OrderDetailView = { ...baseOrder, status: "draft" };

    const { unmount } = render(
      <OrderDetail order={draft} currentRoles={["sales"]} />,
    );

    expect(screen.getByRole("link", { name: "Edit draft" })).toHaveAttribute(
      "href",
      "/sales/orders/00000000-0000-4000-8000-000000000009/edit",
    );
    unmount();

    // Inventory cannot edit drafts.
    render(<OrderDetail order={draft} currentRoles={["inventory"]} />);
    expect(screen.queryByRole("link", { name: "Edit draft" })).toBeNull();
  });

  test("cancelled orders show their reason", () => {
    const cancelled: OrderDetailView = {
      ...baseOrder,
      status: "cancelled",
      cancellationReason: "Duplicate of SO-000199",
      cancelledByName: "Sam Admin",
      cancelledAt: "2026-08-22T14:00:00.000Z",
    };

    render(<OrderDetail order={cancelled} currentRoles={["admin"]} />);

    expect(screen.getByText(/Duplicate of SO-000199/)).toBeDefined();
    expect(screen.getAllByText("Cancelled").length).toBeGreaterThan(0);
  });
});
