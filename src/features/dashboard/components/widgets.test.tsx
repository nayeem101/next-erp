import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  LowStockWidget,
  RecentOrdersWidget,
  TopProductsWidget,
} from "./widgets";

const mocks = vi.hoisted(() => ({
  getLowStock: vi.fn(),
  getRecentOrders: vi.fn(),
  getTopProducts: vi.fn(),
}));

vi.mock("../queries", () => ({
  getLowStock: mocks.getLowStock,
  getRecentOrders: mocks.getRecentOrders,
  getTopProducts: mocks.getTopProducts,
}));

describe("dashboard widgets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("top products hide revenue for the units projection", async () => {
    mocks.getTopProducts.mockResolvedValue([
      {
        productId: "00000000-0000-4000-8000-00000000p001",
        productName: "Cordless Drill",
        sku: "DEMO-DRILL",
        netUnits: 6,
        revenueCents: null,
      },
    ]);

    const element = await TopProductsWidget({
      range: "30d",
      variant: "operations",
    });

    render(element);

    expect(screen.getByText("Cordless Drill")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText(/Revenue figures are not visible/)).toBeVisible();
    expect(screen.queryByText("$")).not.toBeInTheDocument();
  });

  test("top products show revenue for the sales projection", async () => {
    mocks.getTopProducts.mockResolvedValue([
      {
        productId: "00000000-0000-4000-8000-00000000p001",
        productName: "Cordless Drill",
        sku: "DEMO-DRILL",
        netUnits: 6,
        revenueCents: 6000,
      },
    ]);

    render(
      await TopProductsWidget({
        range: "30d",
        variant: "sales",
      }),
    );

    expect(screen.getByText("$60.00")).toBeInTheDocument();
    expect(screen.queryByText(/not visible/)).toBeNull();
  });

  test("empty top products shows the no-sales state", async () => {
    mocks.getTopProducts.mockResolvedValue([]);

    render(await TopProductsWidget({ range: "30d", variant: "sales" }));

    expect(screen.getByText("No sales in this period.")).toBeInTheDocument();
  });

  test("low stock links products with out-of-stock treatment", async () => {
    mocks.getLowStock.mockResolvedValue([
      {
        productId: "00000000-0000-4000-8000-00000000p002",
        productName: "Garden Hose",
        sku: "DEMO-HOSE",
        stockOnHand: 2,
        reorderLevel: 5,
      },
      {
        productId: "00000000-0000-4000-8000-00000000p003",
        productName: "Impact Driver",
        sku: "DEMO-IMPACT",
        stockOnHand: 0,
        reorderLevel: 2,
      },
    ]);

    render(await LowStockWidget());

    const link = screen.getByRole("link", { name: "Garden Hose" });

    expect(link).toHaveAttribute("href", "/inventory/products?q=DEMO-HOSE");
    expect(screen.getByText("2 left")).toBeInTheDocument();
    expect(screen.getByText("Out of stock")).toBeInTheDocument();
  });

  test("recent orders omit money in the operations projection", async () => {
    mocks.getRecentOrders.mockResolvedValue([
      {
        orderId: "00000000-0000-4000-8000-00000000a001",
        orderNumber: "SO-000100",
        status: "confirmed",
        customerName: "Acme Retail",
        createdAt: "2026-08-24T10:00:00.000Z",
        totalCents: null,
      },
    ]);

    render(await RecentOrdersWidget({ variant: "operations" }));

    expect(screen.getByRole("link", { name: "SO-000100" })).toHaveAttribute(
      "href",
      "/sales/orders/00000000-0000-4000-8000-00000000a001",
    );
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByText("Acme Retail")).toBeInTheDocument();
    expect(screen.queryByText("$")).not.toBeInTheDocument();

    expect(mocks.getRecentOrders).toHaveBeenCalledWith("operations");
  });
});
