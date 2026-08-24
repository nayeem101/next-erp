import { Suspense } from "react";

import { DataTableSkeleton } from "@/components/shared/data-table-skeleton";
import { StockMovementsGrid } from "@/features/products/components/stock-movements-grid";
import { listProducts } from "@/features/products/queries";
import { listStockMovements } from "@/features/products/stock-movement-queries";
import { listStockMovementsQuerySchema } from "@/features/products/stock-movement-schemas";
import { listUsers } from "@/features/users/queries";
import { getActionContext } from "@/lib/auth/guards";
import { MODULE_ROLE_REQUIREMENTS } from "@/lib/auth/roles";
import { parseListQuery } from "@/lib/list-query/parse";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Stock movements | NextERP",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function MovementsView({ searchParams }: PageProps) {
  const raw = await searchParams;

  const context = await getActionContext(MODULE_ROLE_REQUIREMENTS.inventory);

  if (!context.ok) {
    return <p className="text-sm text-muted-foreground">Not authorized.</p>;
  }

  // Hostile URLs degrade to defaults; the audit trail opens unfiltered.
  const { query } = parseListQuery(raw, listStockMovementsQuerySchema);

  const [movementPage, productsPage, usersPage] = await Promise.all([
    listStockMovements(query),
    listProducts({
      page: 1,
      pageSize: 100,
      search: undefined,
      categoryId: undefined,
      stockStatus: "all",
      sort: "name",
    }),
    listUsers({
      page: 1,
      pageSize: 200,
      search: undefined,
      status: "active",
    }),
  ]);

  return (
    <StockMovementsGrid
      page={movementPage}
      productOptions={productsPage.rows.map((row) => ({
        id: row.id,
        label: `${row.sku} — ${row.name}`,
      }))}
      actorOptions={usersPage.rows.map((row) => ({
        id: row.id,
        label: row.displayName,
      }))}
      urlValues={{
        productId: query.productId,
        type: query.type,
        actorId: query.actorId,
        from: query.from,
        to: query.to,
        orderNumber: query.orderNumber,
        page: query.page,
        pageSize: query.pageSize,
      }}
    />
  );
}

export default function StockMovementsPage(props: PageProps) {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold">Stock movements</h1>
        <p className="text-sm text-muted-foreground">
          Append-only inventory ledger across every product.
        </p>
      </header>

      <Suspense
        fallback={
          <DataTableSkeleton
            columnLabels={[
              "Product",
              "Type",
              "Delta",
              "Resulting stock",
              "Reference",
              "Reason",
              "Actor",
              "When",
            ]}
            rowCount={5}
          />
        }
      >
        <MovementsView {...props} />
      </Suspense>
    </div>
  );
}
