import { Suspense } from "react";

import { DataTableSkeleton } from "@/components/shared/data-table-skeleton";
import { InvoicesGrid } from "@/features/invoices/components/invoices-grid";
import { listInvoices } from "@/features/invoices/queries";
import { listInvoicesQuerySchema } from "@/features/invoices/schemas";
import { parseListQuery } from "@/lib/list-query/parse";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Invoices | NextERP",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function InvoicesTable({ searchParams }: PageProps) {
  const raw = await searchParams;

  // Hostile or malformed URLs degrade to defaults and rewrite nothing here.
  const { query: rawQuery } = parseListQuery(raw, listInvoicesQuerySchema);
  const page = await listInvoices(rawQuery);

  return (
    <InvoicesGrid
      page={page}
      urlValues={{
        status: rawQuery.status,
        dateFrom: rawQuery.dateFrom,
        dateTo: rawQuery.dateTo,
        page: rawQuery.page,
        pageSize: rawQuery.pageSize,
      }}
    />
  );
}

export default function InvoicesPage(props: PageProps) {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold">Invoice register</h1>
        <p className="text-sm text-muted-foreground">
          Every issued invoice with its order, customer, and download. Voided
          invoices stay listed and downloadable.
        </p>
      </header>

      <Suspense
        fallback={
          <DataTableSkeleton
            columnLabels={[
              "Invoice",
              "Status",
              "Customer",
              "Order",
              "Total",
              "Issued",
            ]}
            rowCount={8}
          />
        }
      >
        <InvoicesTable searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
