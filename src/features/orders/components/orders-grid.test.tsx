import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { OrdersGrid } from "./orders-grid";

import type { OrderListPage, OrderListRow } from "../schemas";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

function row(overrides: Partial<OrderListRow> = {}): OrderListRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    orderNumber: "SO-000101",
    status: "draft",
    version: 1,
    customerName: "Acme Retail",
    customerCompanyName: null,
    creatorName: "Alex Sales",
    totalCents: 25998,
    createdAt: "2026-08-20T10:00:00.000Z",
    confirmedAt: null,
    ...overrides,
  };
}

function page(rows: OrderListRow[]): OrderListPage {
  return {
    rows,
    total: rows.length,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  };
}

describe("orders grid", () => {
  test("renders order links, status badges, customers, and totals", () => {
    render(
      <OrdersGrid
        page={page([
          row(),
          row({
            id: "00000000-0000-4000-8000-000000000002",
            orderNumber: "SO-000102",
            status: "fulfilled",
            customerName: "Globex Supply",
            confirmedAt: "2026-08-21T09:00:00.000Z",
          }),
        ])}
        urlValues={{ status: "all", sort: "newest", page: 1, pageSize: 20 }}
      />,
    );

    const table = screen.getByRole("table");

    expect(screen.getByRole("link", { name: "SO-000101" })).toHaveAttribute(
      "href",
      "/sales/orders/00000000-0000-4000-8000-000000000001",
    );
    // Badges and the filter nav both say "Draft" — scope to the table.
    expect(within(table).getByText("Draft")).toBeDefined();
    expect(within(table).getByText("Fulfilled")).toBeDefined();
    expect(within(table).getByText("Acme Retail")).toBeDefined();
    expect(within(table).getAllByText("$259.98").length).toBeGreaterThan(0);
  });

  test("hides the totals column entirely for role-projected inventory views", () => {
    const projected = page([row({ totalCents: null })]);

    render(
      <OrdersGrid
        page={projected}
        urlValues={{ status: "draft", sort: "newest", page: 1, pageSize: 20 }}
      />,
    );

    expect(screen.queryByText("Total")).toBeNull();
    expect(screen.getByRole("link", { name: "SO-000101" })).toBeDefined();
  });

  test("status filters navigate to canonical hrefs preserving other values", () => {
    render(
      <OrdersGrid
        page={page([row()])}
        urlValues={{
          status: "confirmed",
          sort: "total_desc",
          page: 2,
          pageSize: 20,
        }}
      />,
    );

    const link = screen.getByRole("link", { name: "Fulfilled" });

    // Status changes and page resets; non-default sort is preserved.
    expect(link).toHaveAttribute(
      "href",
      "/sales/orders?status=fulfilled&sort=total_desc",
    );
  });

  test("sort clicks map to canonical order sorts", async () => {
    const user = userEvent.setup();

    render(
      <OrdersGrid
        page={page([row()])}
        urlValues={{ status: "all", sort: "newest", page: 1, pageSize: 20 }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Created/i }));

    expect(mocks.push).toHaveBeenCalledWith("/sales/orders?sort=oldest");
  });

  test("empty states distinguish pristine lists from filtered misses", () => {
    const { unmount } = render(
      <OrdersGrid
        page={page([])}
        urlValues={{ status: "all", sort: "newest", page: 1, pageSize: 20 }}
      />,
    );

    expect(screen.getByText("No orders yet")).toBeDefined();
    unmount();

    render(
      <OrdersGrid
        page={page([])}
        urlValues={{
          status: "cancelled",
          sort: "newest",
          page: 1,
          pageSize: 20,
        }}
      />,
    );

    expect(screen.getAllByText(/No results/).length).toBeGreaterThan(0);
  });
});
