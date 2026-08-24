import { Suspense } from "react";

import { DataTableSkeleton } from "@/components/shared/data-table-skeleton";
import { CategoriesGrid } from "@/features/categories/components/categories-grid";
import { listCategories } from "@/features/categories/queries";
import { listCategoriesQuerySchema } from "@/features/categories/schemas";
import { getActionContext } from "@/lib/auth/guards";
import { parseListQuery } from "@/lib/list-query/parse";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Categories | NextERP",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function CategoriesTable({ searchParams }: PageProps) {
  const raw = await searchParams;

  // Hostile or malformed URLs degrade to defaults and rewrite nothing here;
  // `recovered` is available if we later choose to redirect.
  const { query } = parseListQuery(raw, listCategoriesQuerySchema);

  const [page, context] = await Promise.all([
    listCategories(query),
    getActionContext(),
  ]);

  const roles = context.ok ? context.user.roles : ([] as const);

  return (
    <CategoriesGrid
      page={page}
      currentRoles={[...roles]}
      urlValues={{
        search: query.search,
        status: query.status,
        sort: query.sort,
        page: query.page,
        pageSize: query.pageSize,
      }}
    />
  );
}

export default function CategoriesPage(props: PageProps) {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold">Categories</h1>
        <p className="text-sm text-muted-foreground">
          Group products into categories for browsing and reporting.
        </p>
      </header>

      <Suspense
        fallback={
          <DataTableSkeleton
            columnLabels={["Name", "Description", "Products", "Status"]}
            rowCount={5}
          />
        }
      >
        <CategoriesTable {...props} />
      </Suspense>
    </div>
  );
}
