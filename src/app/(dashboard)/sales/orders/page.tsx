import { Suspense } from "react";

import { DataTableSkeleton } from "@/components/shared/data-table-skeleton";
import { OrdersGrid } from "@/features/orders/components/orders-grid";
import { listOrders } from "@/features/orders/queries";
import { listOrdersQuerySchema } from "@/features/orders/schemas";
import { getActionContext } from "@/lib/auth/guards";
import { parseListQuery } from "@/lib/list-query/parse";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Orders | NextERP",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function OrdersTable({ searchParams }: PageProps) {
  const raw = await searchParams;

  // Hostile or malformed URLs degrade to defaults and rewrite nothing here.
  const { query: rawQuery } = parseListQuery(raw, listOrdersQuerySchema);

  const [context, page] = await Promise.all([
    getActionContext(),
    listOrders(rawQuery, { includeTotals: true }),
  ]);

  const roles = context.ok ? context.user.roles : ([] as const);

  // Role projection: inventory-only viewers receive null totals.
  const canSeeFinancials = hasFinancialVisibility([...roles]);

  const projectedPage = canSeeFinancials
    ? page
    : {
        ...page,
        rows: page.rows.map((row) => ({ ...row, totalCents: null })),
      };

  return (
    <OrdersGrid
      page={projectedPage}
      urlValues={{
        status: rawQuery.status,
        sort: rawQuery.sort,
        page: rawQuery.page,
        pageSize: rawQuery.pageSize,
      }}
    />
  );
}

function hasFinancialVisibility(roles: string[]): boolean {
  return roles.includes("admin") || roles.includes("sales");
}

export default function OrdersPage(props: PageProps) {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold">Sales orders</h1>
        <p className="text-sm text-muted-foreground">
          Track drafts through confirmation, fulfillment, and cancellation.
        </p>
      </header>

      <Suspense
        fallback={
          <DataTableSkeleton
            columnLabels={["Order", "Status", "Customer", "Total", "Created"]}
            rowCount={8}
          />
        }
      >
        <OrdersTable searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
