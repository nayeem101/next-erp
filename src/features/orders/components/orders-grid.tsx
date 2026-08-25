"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import {
  createDataTableColumnHelper,
  DataTable,
  type DataTableSort,
} from "@/components/shared/data-table/data-table";
import { DataTablePagination } from "@/components/shared/data-table/data-table-pagination";
import { EmptyState, Money } from "@/components/shared/display";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";

import type { OrderListPage, OrderListRow } from "../schemas";

const columnHelper = createDataTableColumnHelper<OrderListRow>();

interface OrdersGridValues {
  status: string;
  sort: string;
  page: number;
  pageSize: number;
}

const DEFAULTS = {
  status: "all",
  sort: "newest",
  page: 1,
  pageSize: 20,
} as const;

const STATUS_FILTERS = ["draft", "confirmed", "fulfilled", "cancelled", "all"];

const STATUS_LABELS: Record<string, string> = {
  all: "All",
  draft: "Draft",
  confirmed: "Confirmed",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
};

function statusBadgeVariant(
  status: OrderListRow["status"],
): "default" | "success" | "warning" | "destructive" | "secondary" {
  switch (status) {
    case "confirmed":
      return "default";
    case "fulfilled":
      return "success";
    case "cancelled":
      return "destructive";
    default:
      return "warning";
  }
}

/**
 * Role-projected orders grid bound to URL state. Inventory viewers lack the
 * financial projection, so total columns render only when totals exist.
 */
export function OrdersGrid({
  page,
  urlValues,
}: {
  page: OrderListPage;
  urlValues: OrdersGridValues;
}) {
  const router = useRouter();

  const basePath = "/sales/orders";
  const values = urlValues;

  function hrefFor(patch: Partial<OrdersGridValues>): string {
    const params = new URLSearchParams();

    const merged = { ...values, ...patch };

    for (const [key, value] of Object.entries(merged)) {
      const isDefault =
        String(value) === String(DEFAULTS[key as keyof typeof DEFAULTS]);

      if (!isDefault) {
        params.set(key, String(value));
      }
    }

    const query = params.toString();

    return query === "" ? basePath : `${basePath}?${query}`;
  }

  function handleSortChange(sort: DataTableSort | null): void {
    if (!sort) {
      return;
    }

    const sortValue = sortValueFor(sort.id, sort.desc);

    if (sortValue) {
      router.push(hrefFor({ sort: sortValue, page: DEFAULTS.page }));
    }
  }

  const showTotals = page.rows.some((row) => row.totalCents !== null);

  const columns = React.useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("orderNumber", {
          header: "Order",
          cell: (cell) => (
            <Link
              className="font-medium underline-offset-4 hover:underline"
              href={`/sales/orders/${cell.row.original.id}`}
            >
              {cell.getValue()}
            </Link>
          ),
        }),
        columnHelper.accessor("status", {
          header: "Status",
          cell: (cell) => (
            <Badge variant={statusBadgeVariant(cell.getValue())}>
              {STATUS_LABELS[cell.getValue()] ?? cell.getValue()}
            </Badge>
          ),
        }),
        columnHelper.accessor("customerName", {
          header: "Customer",
          cell: (cell) => (
            <div className="flex flex-col">
              <span>{cell.getValue()}</span>
              {cell.row.original.customerCompanyName !== null && (
                <span className="text-xs text-muted-foreground">
                  {cell.row.original.customerCompanyName}
                </span>
              )}
            </div>
          ),
        }),
        ...(showTotals
          ? [
              columnHelper.accessor("totalCents", {
                id: "totalCents",
                header: "Total",
                cell: (cell) => (
                  <Money
                    amountCents={cell.getValue() ?? 0}
                    className="text-sm"
                  />
                ),
              }),
            ]
          : []),
        columnHelper.accessor("createdAt", {
          id: "createdAt",
          header: "Created",
          cell: (cell) => (
            <time dateTime={cell.getValue()}>
              {new Date(cell.getValue()).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </time>
          ),
        }),
      ]),
    [showTotals],
  );

  const isEmpty = page.rows.length === 0;
  const hasFilters =
    values.status !== DEFAULTS.status ||
    values.sort !== DEFAULTS.sort ||
    values.page !== DEFAULTS.page;

  return (
    <>
      <div className="flex justify-end">
        <Link
          className={buttonVariants({ variant: "default" })}
          href="/sales/orders/new"
        >
          New order
        </Link>
      </div>

      <nav aria-label="Filter by status" className="flex rounded-md border">
        {[...STATUS_FILTERS].reverse().map((status) => {
          const isCurrent = values.status === status;

          return (
            <Link
              key={status}
              aria-current={isCurrent ? "page" : undefined}
              className={
                isCurrent
                  ? "bg-primary px-3 py-1.5 text-sm text-primary-foreground first:rounded-l-md last:rounded-r-md"
                  : "px-3 py-1.5 text-sm first:rounded-l-md last:rounded-r-md hover:bg-muted"
              }
              href={hrefFor({ status, page: DEFAULTS.page })}
            >
              {STATUS_LABELS[status] ?? status}
            </Link>
          );
        })}
      </nav>

      {isEmpty && !hasFilters ? (
        <EmptyState
          title="No orders yet"
          description="Create the first draft order to get started."
        />
      ) : isEmpty && hasFilters ? (
        <EmptyState title="No results" description="" filtered />
      ) : (
        <DataTable
          ariaLabel="Orders"
          columns={columns}
          rows={page.rows}
          sort={sortFromUrl(values.sort)}
          onSortChange={handleSortChange}
        />
      )}

      <DataTablePagination
        basePath={basePath}
        values={{ ...values, search: undefined }}
        defaults={DEFAULTS}
        total={page.total}
      />
    </>
  );
}

function sortValueFor(id: string, desc: boolean): string | null {
  if (id === "createdAt") {
    return desc ? "newest" : "oldest";
  }

  if (id === "totalCents") {
    return desc ? "total_desc" : "total_asc";
  }

  return null;
}

function sortFromUrl(sort: string): DataTableSort | null {
  switch (sort) {
    case "oldest":
      return { id: "createdAt", desc: false };
    case "total_desc":
      return { id: "totalCents", desc: true };
    case "total_asc":
      return { id: "totalCents", desc: false };
    case "newest":
      return { id: "createdAt", desc: true };
    default:
      return null;
  }
}
