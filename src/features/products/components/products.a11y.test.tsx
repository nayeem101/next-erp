import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, expect, test, vi } from "vitest";

import { ProductsGrid } from "@/features/products/components/products-grid";
import { StockMovementTable } from "@/features/products/components/stock-movement-table";
import type { ProductListPage } from "@/features/products/schemas";
import type {
  StockMovementPage,
  StockMovementRow,
} from "@/features/products/stock-movement-schemas";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

expect.extend(toHaveNoViolations);

const categoryOptions = [
  { id: "11111111-1111-4111-8111-111111111111", label: "Power Tools" },
];

const productRow = {
  id: "00000000-0000-4000-8000-000000000001",
  categoryId: "11111111-1111-4111-8111-111111111111",
  categoryName: "Power Tools",
  sku: "SKU-1000",
  name: "Cordless Drill",
  description: null,
  unitPriceCents: 8999,
  stockOnHand: 4,
  reorderLevel: 10,
  isActive: true,
  createdAt: "2026-08-01T10:00:00.000Z",
};

const movementRow: StockMovementRow = {
  id: "00000000-0000-4000-8000-00000000a001",
  productId: productRow.id,
  productSku: productRow.sku,
  productName: productRow.name,
  type: "opening",
  quantityDelta: 40,
  resultingStock: 40,
  reason: "Opening balance",
  orderId: null,
  orderNumber: null,
  actorId: "00000000-0000-4000-8000-00000000c001",
  actorName: "Alex Admin",
  createdAt: "2026-08-20T09:30:00.000Z",
};

function productsPage(rows: unknown[]): ProductListPage {
  return {
    rows: rows as ProductListPage["rows"],
    total: rows.length,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  };
}

describe("inventory accessibility (axe)", () => {
  test("products grid has no violations with data and filters", async () => {
    const { container } = render(
      <ProductsGrid
        page={productsPage([productRow])}
        currentRoles={["admin"]}
        categoryOptions={categoryOptions}
        urlValues={{
          search: undefined,
          categoryId: undefined,
          stockStatus: "all",
          sort: "name",
          page: 1,
          pageSize: 20,
        }}
      />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });

  test("products grid empty state has no violations", async () => {
    const { container } = render(
      <ProductsGrid
        page={productsPage([])}
        currentRoles={[]}
        categoryOptions={categoryOptions}
        urlValues={{
          search: undefined,
          categoryId: undefined,
          stockStatus: "active",
          sort: "name",
          page: 1,
          pageSize: 20,
        }}
      />,
    );

    expect(await axe(container)).toHaveNoViolations();
    expect(screen.getByText(/no products yet/i)).toBeInTheDocument();
  });

  test("stock movement table has no violations", async () => {
    const movementPage: StockMovementPage = {
      rows: [movementRow],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    };

    const { container } = render(
      <StockMovementTable
        productId={productRow.id}
        page={movementPage}
        showProductColumn
        urlValues={{ page: 1, pageSize: 20 }}
      />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });

  test("movement empty state has no violations", async () => {
    const movementPage: StockMovementPage = {
      rows: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    };

    const { container } = render(
      <StockMovementTable
        productId={productRow.id}
        page={movementPage}
        urlValues={{ page: 1, pageSize: 20 }}
      />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
