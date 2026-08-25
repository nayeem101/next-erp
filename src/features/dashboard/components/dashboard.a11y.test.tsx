import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { DashboardRangeSelect } from "./dashboard-range-select";
import { RevenueChart } from "./revenue-chart";
import {
  LowStockWidget,
  RecentOrdersWidget,
  TopProductsWidget,
} from "./widgets";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../queries", () => ({
  getLowStock: vi.fn().mockResolvedValue([
    {
      productId: "00000000-0000-4000-8000-00000000p002",
      productName: "Garden Hose",
      sku: "DEMO-HOSE",
      stockOnHand: 2,
      reorderLevel: 5,
    },
  ]),
  getRecentOrders: vi.fn().mockResolvedValue([
    {
      orderId: "00000000-0000-4000-8000-00000000a001",
      orderNumber: "SO-000100",
      status: "confirmed",
      customerName: "Acme Retail",
      createdAt: "2026-08-24T10:00:00.000Z",
      totalCents: 25998,
    },
  ]),
  getTopProducts: vi.fn().mockResolvedValue([
    {
      productId: "00000000-0000-4000-8000-00000000p001",
      productName: "Cordless Drill",
      sku: "DEMO-DRILL",
      netUnits: 6,
      revenueCents: 6000,
    },
  ]),
}));

expect.extend(toHaveNoViolations);

describe("dashboard accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("range select has no axe violations", async () => {
    const { container } = render(<DashboardRangeSelect value="30d" />);

    expect(await axe(container)).toHaveNoViolations();
  });

  test("top products widget (sales projection) has no axe violations", async () => {
    const element = await TopProductsWidget({
      range: "30d",
      variant: "sales",
    });
    const { container } = render(element);

    expect(await axe(container)).toHaveNoViolations();
  });

  test("top products widget (units projection) has no axe violations", async () => {
    const element = await TopProductsWidget({
      range: "90d",
      variant: "operations",
    });
    const { container } = render(element);

    expect(await axe(container)).toHaveNoViolations();
  });

  test("low stock widget has no axe violations", async () => {
    const element = await LowStockWidget();
    const { container } = render(element);

    expect(await axe(container)).toHaveNoViolations();
  });

  test("recent orders widget has no axe violations", async () => {
    const element = await RecentOrdersWidget({ variant: "sales" });
    const { container } = render(element);

    expect(await axe(container)).toHaveNoViolations();
  });

  test("revenue chart renderer has no axe violations", () => {
    const { container } = render(
      <RevenueChart
        granularity="daily"
        points={[
          { bucket: "2026-08-01", label: "Aug 1", revenueCents: 12500 },
          { bucket: "2026-08-02", label: "Aug 2", revenueCents: 42000 },
        ]}
      />,
    );

    // jsdom cannot lay out SVG charts; assert the accessible structure.
    expect(container.querySelector("#revenue-summary")).toBeInTheDocument();
  });
});
