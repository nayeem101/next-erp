import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { ProductsGrid } from "@/features/products/components/products-grid";
import type {
  ProductListPage,
  ProductListRow,
} from "@/features/products/schemas";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  setProductActiveAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock("@/features/products/actions", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  setProductActiveAction: mocks.setProductActiveAction,
}));

const categoryOptions = [
  { id: "11111111-1111-4111-8111-111111111111", label: "Power Tools" },
  { id: "22222222-2222-4222-8222-222222222222", label: "Garden" },
];

const POWER_TOOLS_ID = categoryOptions[0]?.id ?? "";

function row(overrides: Partial<ProductListRow>): ProductListRow {
  return {
    id: overrides.id ?? "00000000-0000-4000-8000-000000000001",
    categoryId: POWER_TOOLS_ID,
    categoryName: overrides.categoryName ?? "Power Tools",
    sku: overrides.sku ?? "SKU-1000",
    name: overrides.name ?? "Cordless Drill",
    description: overrides.description ?? null,
    unitPriceCents: overrides.unitPriceCents ?? 8999,
    stockOnHand: overrides.stockOnHand ?? 40,
    reorderLevel: overrides.reorderLevel ?? 10,
    isActive: overrides.isActive ?? true,
    createdAt: overrides.createdAt ?? "2026-08-01T10:00:00.000Z",
  };
}

const urlValues = {
  search: undefined,
  categoryId: undefined,
  stockStatus: "active",
  sort: "name",
  page: 1,
  pageSize: 20,
} as const;

function makePage(rows: ProductListRow[]): ProductListPage {
  return {
    rows,
    total: rows.length,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  };
}

beforeEach(() => {
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.setProductActiveAction.mockReset();
});

describe("ProductsGrid rendering", () => {
  test("renders SKU, name with category, money, stock, and status badges", () => {
    render(
      <ProductsGrid
        page={makePage([
          row({}),
          row({
            id: "00000000-0000-4000-8000-000000000002",
            sku: "SKU-2000",
            name: "Garden Hose",
            categoryName: "Garden",
            unitPriceCents: 123456,
            isActive: false,
          }),
        ])}
        currentRoles={["admin"]}
        categoryOptions={categoryOptions}
        urlValues={{ ...urlValues, stockStatus: "all" }}
      />,
    );

    const table = screen.getByRole("table", { name: "Products" });

    expect(within(table).getByText("SKU-1000")).toBeInTheDocument();
    expect(within(table).getByText("Cordless Drill")).toBeInTheDocument();
    expect(within(table).getByText("$89.99")).toBeInTheDocument();
    expect(within(table).getByText("$1,234.56")).toBeInTheDocument();
    expect(within(table).getByText("Archived")).toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", { name: /stock/i }),
    ).toHaveAttribute("scope", "col");
  });

  test("marks at-or-below-reorder active stock with icon and sr-only note", () => {
    render(
      <ProductsGrid
        page={makePage([
          row({ stockOnHand: 10, reorderLevel: 10 }),
          row({
            id: "00000000-0000-4000-8000-000000000003",
            sku: "SKU-3000",
            name: "Healthy Stock",
            stockOnHand: 41,
            reorderLevel: 10,
          }),
        ])}
        currentRoles={["admin"]}
        categoryOptions={categoryOptions}
        urlValues={{ ...urlValues }}
      />,
    );

    const note = screen.getByText("(low stock)");

    // The sr-only note sits inside the colored stock wrapper.
    const stockCell = note.parentElement;

    expect(stockCell).toHaveClass("text-destructive");
    // Healthy row shows the plain number only.
    expect(screen.getByText("41")).toBeInTheDocument();
    // Exactly one low-stock marker across both rows.
    expect(screen.getAllByText("(low stock)")).toHaveLength(1);
  });

  test("shows the unfiltered empty state for a fresh workspace", () => {
    render(
      <ProductsGrid
        page={makePage([])}
        currentRoles={["admin"]}
        categoryOptions={categoryOptions}
        urlValues={{ ...urlValues }}
      />,
    );

    expect(screen.getByText(/no products yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  test("shows the filtered empty state when filters hide everything", () => {
    render(
      <ProductsGrid
        page={makePage([])}
        currentRoles={["admin"]}
        categoryOptions={categoryOptions}
        urlValues={{ ...urlValues, search: "zzz" }}
      />,
    );

    expect(screen.getByText(/adjust or reset them/i)).toBeInTheDocument();
  });
});

describe("role-aware actions", () => {
  test("hides manage actions from sales and keeps read-only view", () => {
    render(
      <ProductsGrid
        page={makePage([row({})])}
        currentRoles={["sales"]}
        categoryOptions={categoryOptions}
        urlValues={{ ...urlValues }}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /archive/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /new product/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Cordless Drill")).toBeInTheDocument();
  });

  test("archive flow confirms then calls the action with false", async () => {
    const user = userEvent.setup();

    mocks.setProductActiveAction.mockResolvedValue({
      ok: true,
      data: { productId: row({}).id, isActive: false },
    });

    render(
      <ProductsGrid
        page={makePage([row({})])}
        currentRoles={["inventory"]}
        categoryOptions={categoryOptions}
        urlValues={{ ...urlValues }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^archive$/i }));

    const dialog = screen.getByRole("dialog");

    expect(
      within(dialog).getByRole("heading", { name: "Archive product" }),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: /^archive$/i }),
    );

    await waitFor(() => {
      expect(mocks.setProductActiveAction).toHaveBeenCalledWith({
        productId: row({}).id,
        isActive: false,
      });
    });
    await waitFor(() => {
      expect(mocks.refresh).toHaveBeenCalled();
    });
  });

  test("surfaces conflicts inline without closing the dialog", async () => {
    const user = userEvent.setup();

    mocks.setProductActiveAction.mockResolvedValue({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "Restore the product's category before restoring it.",
      },
    });

    render(
      <ProductsGrid
        page={makePage([row({ isActive: false })])}
        currentRoles={["admin"]}
        categoryOptions={categoryOptions}
        urlValues={{ ...urlValues, stockStatus: "archived" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^restore$/i }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^restore$/i,
      }),
    );

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(/restore the product's category/i);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("URL-state wiring", () => {
  test("status segments expose canonical hrefs with current marker", () => {
    render(
      <ProductsGrid
        page={makePage([row({})])}
        currentRoles={["admin"]}
        categoryOptions={categoryOptions}
        urlValues={{ ...urlValues }}
      />,
    );

    const lowStockLink = screen.getByRole("link", { name: "Low stock" });

    expect(lowStockLink).toHaveAttribute(
      "href",
      "/inventory/products?stockStatus=low_stock",
    );
    expect(lowStockLink).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Active" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    expect(screen.getByRole("link", { name: "All" })).toHaveAttribute(
      "href",
      "/inventory/products?stockStatus=all",
    );
  });

  test("sort clicks map column order to allowlisted sort values", async () => {
    const user = userEvent.setup();

    render(
      <ProductsGrid
        page={makePage([row({})])}
        currentRoles={["admin"]}
        categoryOptions={categoryOptions}
        urlValues={{ ...urlValues }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /unit price/i }));

    expect(mocks.push).toHaveBeenCalledWith(
      "/inventory/products?sort=price_asc",
    );
  });

  test("pagination renders server totals and navigates pages", async () => {
    const user = userEvent.setup();

    render(
      <ProductsGrid
        page={{
          ...makePage([row({})]),
          total: 45,
          totalPages: 3,
        }}
        currentRoles={["admin"]}
        categoryOptions={categoryOptions}
        urlValues={{ ...urlValues, page: 2 }}
      />,
    );

    expect(screen.getByText(/showing 21–40 of 45/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /go to page 3/i }));

    expect(mocks.push).toHaveBeenCalledWith("/inventory/products?page=3");
  });
});
