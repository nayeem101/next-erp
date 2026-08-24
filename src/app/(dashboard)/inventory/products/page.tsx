import { Suspense } from "react";

import { DataTableSkeleton } from "@/components/shared/data-table-skeleton";
import { listCategories } from "@/features/categories/queries";
import { ProductsGrid } from "@/features/products/components/products-grid";
import { listProducts } from "@/features/products/queries";
import { listProductsQuerySchema } from "@/features/products/schemas";
import { getActionContext } from "@/lib/auth/guards";
import { parseListQuery } from "@/lib/list-query/parse";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Products | NextERP",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function ProductsTable({ searchParams }: PageProps) {
  const raw = await searchParams;

  // Hostile or malformed URLs degrade to defaults and rewrite nothing here;
  // `recovered` is available if we later choose to redirect.
  const { query } = parseListQuery(raw, listProductsQuerySchema);

  const [page, categoriesPage, context] = await Promise.all([
    listProducts(query),
    listCategories({
      page: 1,
      pageSize: 100,
      status: "active",
      sort: "name",
      search: undefined,
    }),
    getActionContext(),
  ]);

  const roles = context.ok ? context.user.roles : ([] as const);

  return (
    <ProductsGrid
      page={page}
      currentRoles={[...roles]}
      categoryOptions={categoriesPage.rows.map((row) => ({
        id: row.id,
        label: row.name,
      }))}
      urlValues={{
        search: query.search,
        categoryId: query.categoryId,
        stockStatus: query.stockStatus,
        sort: query.sort,
        page: query.page,
        pageSize: query.pageSize,
      }}
    />
  );
}

export default function ProductsPage(props: PageProps) {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold">Products</h1>
        <p className="text-sm text-muted-foreground">
          Search and administer product master data and current stock.
        </p>
      </header>

      <Suspense
        fallback={
          <DataTableSkeleton
            columnLabels={[
              "SKU",
              "Name",
              "Unit price",
              "Stock",
              "Reorder at",
              "Status",
            ]}
            rowCount={5}
          />
        }
      >
        <ProductsTable {...props} />
      </Suspense>
    </div>
  );
}
