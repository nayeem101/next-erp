import * as React from "react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Column-aware loading skeleton matching the grid chrome: header labels stay
 * visible while rows render as pulsing placeholders sized by column widths.
 */
export function DataTableSkeleton({
  columnLabels,
  rowCount = 5,
  className,
}: {
  /** Header labels rendered statically so layout does not jump. */
  columnLabels: string[];
  rowCount?: number;
  className?: string;
}) {
  const rowIndices = Array.from({ length: rowCount }, (_, index) => index);
  const columnIndices = Array.from(
    { length: columnLabels.length },
    (_, index) => index,
  );

  return (
    <div
      data-slot="data-table-skeleton"
      aria-busy="true"
      aria-label="Loading table"
      className={cn("overflow-x-auto rounded-lg border", className)}
    >
      <Table>
        <TableHeader>
          <TableRow>
            {columnLabels.map((label) => (
              <TableHead key={label}>{label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rowIndices.map((row) => (
            <TableRow key={row}>
              {columnIndices.map((column) => (
                <TableCell key={column}>
                  <Skeleton
                    className={cn(
                      "h-4",
                      (row + column) % 3 === 0 ? "w-24" : "w-32",
                    )}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
