"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";

import {
  createDataTableColumnHelper,
  DataTable,
} from "@/components/shared/data-table/data-table";
import { DataTablePagination } from "@/components/shared/data-table/data-table-pagination";
import { EmptyState, LocalDateTime } from "@/components/shared/display";
import { Badge } from "@/components/ui/badge";
import type {
  CanonicalDefaults,
  CanonicalValues,
} from "@/lib/list-query/canonical";

import type {
  StockMovementPage,
  StockMovementRow,
} from "../stock-movement-schemas";

const columnHelper = createDataTableColumnHelper<StockMovementRow>();

const TYPE_LABELS: Record<StockMovementRow["type"], string> = {
  opening: "Opening",
  adjustment: "Adjustment",
  sale: "Sale",
  sale_reversal: "Reversal",
};

/**
 * Append-only movement history for one product.  Pagination and sorting are
 * URL-bound; the table itself is intentionally read-only.
 */
export function StockMovementTable({
  productId,
  page,
  urlValues,
  showProductColumn = false,
  basePathOverride,
}: {
  productId: string;
  page: StockMovementPage;
  urlValues: CanonicalValues;
  /** Cross-product views add a product identity column. */
  showProductColumn?: boolean;
  /** Defaults to the product detail scope. */
  basePathOverride?: string;
}) {
  const basePath = basePathOverride ?? `/inventory/products/${productId}`;
  const defaults: CanonicalDefaults = { page: 1, pageSize: 20 };

  const columns = [
    ...(showProductColumn
      ? [
          columnHelper.accessor("productSku", {
            header: "Product",
            cell: (cell) => {
              const rowData = cell.row.original;

              return (
                <div className="flex flex-col">
                  <Link
                    className="font-mono text-xs underline-offset-2 hover:underline"
                    href={`/inventory/products/${rowData.productId}`}
                  >
                    {rowData.productSku}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {rowData.productName}
                  </span>
                </div>
              );
            },
          }),
        ]
      : []),
    columnHelper.accessor("type", {
      header: "Type",
      cell: (cell) => {
        const movementType = cell.getValue();

        return (
          <Badge variant={movementType === "sale" ? "default" : "secondary"}>
            {TYPE_LABELS[movementType]}
          </Badge>
        );
      },
    }),
    columnHelper.accessor("quantityDelta", {
      header: "Delta",
      cell: (cell) => {
        const delta = cell.getValue();
        const Icon = delta >= 0 ? ArrowUpRight : ArrowDownRight;

        return (
          <span className="flex items-center gap-1 tabular-nums">
            <Icon aria-hidden className="size-3.5" />
            <span>{delta > 0 ? `+${String(delta)}` : String(delta)}</span>
          </span>
        );
      },
    }),
    columnHelper.accessor("resultingStock", {
      header: "Resulting stock",
      cell: (cell) => <span className="tabular-nums">{cell.getValue()}</span>,
    }),
    columnHelper.accessor("orderNumber", {
      header: "Reference",
      cell: (cell) => {
        const rowData = cell.row.original;

        if (rowData.orderId === null || rowData.orderNumber === null) {
          return <span className="text-muted-foreground">—</span>;
        }

        return (
          <Link
            className="font-mono text-xs underline-offset-2 hover:underline"
            href={`/sales/orders/${rowData.orderId}`}
          >
            {rowData.orderNumber}
          </Link>
        );
      },
    }),
    columnHelper.accessor("reason", {
      header: "Reason",
      cell: (cell) => (
        <span className="line-clamp-1 max-w-xs text-sm text-muted-foreground">
          {cell.getValue()}
        </span>
      ),
    }),
    columnHelper.accessor("actorName", {
      header: "Actor",
    }),
    columnHelper.accessor("createdAt", {
      header: "When",
      cell: (cell) => (
        <LocalDateTime value={cell.getValue()} className="text-sm" />
      ),
    }),
  ];

  if (page.rows.length === 0) {
    return <EmptyState title="No stock movements recorded." description="" />;
  }

  return (
    <>
      <DataTable
        ariaLabel="Stock movements"
        columns={columnHelper.columns(columns)}
        rows={page.rows}
        emptyState={undefined}
      />

      <DataTablePagination
        basePath={basePath}
        values={urlValues}
        defaults={defaults}
        total={page.total}
      />
    </>
  );
}
