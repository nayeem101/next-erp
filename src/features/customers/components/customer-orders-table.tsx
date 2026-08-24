"use client";

import Link from "next/link";

import {
  createDataTableColumnHelper,
  DataTable,
} from "@/components/shared/data-table/data-table";
import { DataTablePagination } from "@/components/shared/data-table/data-table-pagination";
import { EmptyState, Money } from "@/components/shared/display";
import { Badge } from "@/components/ui/badge";
import type {
  CanonicalDefaults,
  CanonicalValues,
} from "@/lib/list-query/canonical";

import type { CustomerOrderPage, CustomerOrderRow } from "../schemas";

const columnHelper = createDataTableColumnHelper<CustomerOrderRow>();

const DEFAULTS: CanonicalDefaults = {
  page: 1,
  pageSize: 10,
};

const STATUS_BADGES: Record<
  CustomerOrderRow["status"],
  {
    label: string;
    variant: "secondary" | "success" | "warning" | "destructive";
  }
> = {
  draft: { label: "Draft", variant: "secondary" },
  confirmed: { label: "Confirmed", variant: "success" },
  fulfilled: { label: "Fulfilled", variant: "success" },
  cancelled: { label: "Cancelled", variant: "destructive" },
};

/**
 * Paginated order history for one customer. Scoped URL state covers
 * page/pageSize only; customer identity comes from the route.
 */
export function CustomerOrdersTable({
  customerId,
  page,
  urlValues,
}: {
  customerId: string;
  page: CustomerOrderPage;
  urlValues: CanonicalValues;
}) {
  const columns = columnHelper.columns([
    columnHelper.accessor("orderNumber", {
      header: "Order",
      cell: (cell) => (
        <Link
          className="font-mono text-xs underline-offset-4 hover:underline"
          href={`/sales/orders/${cell.row.original.id}`}
        >
          {cell.getValue()}
        </Link>
      ),
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: (cell) => {
        const badge = STATUS_BADGES[cell.getValue()];

        return <Badge variant={badge.variant}>{badge.label}</Badge>;
      },
    }),
    columnHelper.accessor("totalCents", {
      id: "total",
      header: "Total",
      cell: (cell) => (
        <Money amountCents={cell.getValue()} className="text-sm" />
      ),
    }),
    columnHelper.accessor("createdAt", {
      header: "Created",
      cell: (cell) => (
        <span className="text-sm text-muted-foreground">
          {new Date(cell.getValue()).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </span>
      ),
    }),
    columnHelper.accessor("confirmedAt", {
      header: "Confirmed",
      cell: (cell) => {
        const confirmedAt = cell.getValue();

        return confirmedAt === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="text-sm text-muted-foreground">
            {new Date(confirmedAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </span>
        );
      },
    }),
  ]);

  if (page.rows.length === 0) {
    return (
      <EmptyState
        title="No orders yet"
        description="Orders for this customer will appear here once sales creates them."
      />
    );
  }

  return (
    <>
      <DataTable
        ariaLabel="Order history"
        columns={columns}
        rows={page.rows}
        sort={null}
        onSortChange={() => {
          // History reads newest-first; sorting is not exposed here.
        }}
      />

      <DataTablePagination
        basePath={`/customers/${customerId}`}
        values={urlValues}
        defaults={DEFAULTS}
        total={page.total}
      />
    </>
  );
}
