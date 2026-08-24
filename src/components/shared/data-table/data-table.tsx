"use client";

import {
  createCoreRowModel,
  createSortedRowModel,
  createTableHook,
  coreFeatures,
  flexRender,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/react-table";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** Server-driven sort descriptor shared by every grid consumer. */
export interface DataTableSort {
  desc: boolean;
  id: string;
}

export interface DataTableProps<TData> {
  ariaLabel: string;
  /**
   * Column definitions built through {@link createDataTableColumnHelper};
   * typed loosely here because the helper already validates each definition
   * against its concrete row type.
   */
  columns: readonly object[];
  rows: TData[];
  /** Accessible caption context; also used for empty-state copy hooks. */
  isLoading?: boolean;
  emptyState?: React.ReactNode;
  // Server-side sorting contract.
  sort?: DataTableSort | null;
  onSortChange?: (sort: DataTableSort | null) => void;
}

const dataTableHook = createTableHook({
  features: tableFeatures({
    ...coreFeatures,
    rowSortingFeature,
    coreRowModel: createCoreRowModel(),
    sortedRowModel: createSortedRowModel(),
  }),
});

/**
 * Column-definition factory pre-bound to the shared grid features. Consumer
 * grids build their typed columns through this helper so definitions stay
 * compatible with {@link DataTable}.
 */
export const createDataTableColumnHelper = dataTableHook.createAppColumnHelper;

/**
 * Reusable grid shell for server-fed lists. Sorting is controlled: the table
 * never re-orders rows itself; header clicks surface a `DataTableSort`
 * descriptor the page translates into query parameters.
 */
export function DataTable<TData extends object>({
  ariaLabel,
  columns,
  rows,
  isLoading = false,
  emptyState,
  sort = null,
  onSortChange,
}: DataTableProps<TData>) {
  const table = dataTableHook.useAppTable({
    columns: columns as never,
    data: rows as never,
    state: { sorting: sort ? [{ desc: sort.desc, id: sort.id }] : [] },
    manualSorting: true,
    enableSortingRemoval: true,
    onSortingChange: (updater) => {
      if (!onSortChange) {
        return;
      }

      const next =
        typeof updater === "function" ? updater(table.state.sorting) : updater;

      onSortChange(
        next.length > 0
          ? { desc: next[0]?.desc ?? false, id: next[0]?.id ?? "" }
          : null,
      );
    },
  });

  if (rows.length === 0 && !isLoading) {
    return <>{emptyState ?? null}</>;
  }

  return (
    <div
      className={cn(
        "overflow-x-auto rounded-lg border",
        isLoading && "opacity-60",
      )}
      aria-busy={isLoading || undefined}
    >
      <Table aria-label={ariaLabel}>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const canSort =
                  header.column.getCanSort() && Boolean(onSortChange);

                return (
                  <TableHead
                    key={header.id}
                    aria-sort={
                      sorted === "asc"
                        ? "ascending"
                        : sorted === "desc"
                          ? "descending"
                          : undefined
                    }
                  >
                    {canSort ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        className="-ml-1 font-medium"
                        onClick={() => {
                          header.column.toggleSorting(sorted === "asc");
                        }}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        <span aria-hidden="true">
                          {sorted === "asc"
                            ? "▲"
                            : sorted === "desc"
                              ? "▼"
                              : "↕"}
                        </span>
                      </Button>
                    ) : (
                      flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
