import { Suspense } from "react";

import { DataTableSkeleton } from "@/components/shared/data-table-skeleton";
import { CustomersGrid } from "@/features/customers/components/customers-grid";
import { listCustomers } from "@/features/customers/queries";
import { listCustomersQuerySchema } from "@/features/customers/schemas";
import { getActionContext } from "@/lib/auth/guards";
import { parseListQuery } from "@/lib/list-query/parse";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Customers | NextERP",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function CustomersTable({ searchParams }: PageProps) {
  const raw = await searchParams;

  // Hostile or malformed URLs degrade to defaults and rewrite nothing here.
  const { query } = parseListQuery(raw, listCustomersQuerySchema);

  const [page, context] = await Promise.all([
    listCustomers(query),
    getActionContext(),
  ]);

  const roles = context.ok ? context.user.roles : ([] as const);

  return (
    <CustomersGrid
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

export default function CustomersPage(props: PageProps) {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold">Customers</h1>
        <p className="text-sm text-muted-foreground">
          Search and administer customer accounts and their sales engagement.
        </p>
      </header>

      <Suspense
        fallback={
          <DataTableSkeleton
            columnLabels={[
              "Name",
              "Contact",
              "Location",
              "Orders",
              "Confirmed sales",
              "Status",
            ]}
            rowCount={5}
          />
        }
      >
        <CustomersTable {...props} />
      </Suspense>
    </div>
  );
}
