"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  listQueryHref,
  type CanonicalDefaults,
  type CanonicalValues,
} from "@/lib/list-query/canonical";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

/**
 * Server-pagination controls. Page and page-size changes navigate to
 * canonical hrefs; the count line reflects server totals.
 */
export function DataTablePagination({
  basePath,
  values,
  defaults = {},
  total,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
}: {
  basePath: string;
  values: CanonicalValues;
  defaults?: CanonicalDefaults;
  /** Total rows on the server for the active filter set. */
  total: number;
  pageSizeOptions?: number[];
}) {
  const router = useRouter();

  const page =
    typeof values.page === "string" || typeof values.page === "number"
      ? Number(values.page)
      : 1;
  const pageSize = Number(
    typeof values.pageSize === "string" || typeof values.pageSize === "number"
      ? values.pageSize
      : 20,
  );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(total, page * pageSize);

  function goTo(nextPage: number): void {
    router.push(listQueryHref(basePath, values, { page: nextPage }, defaults));
  }

  function changePageSize(nextSize: string): void {
    router.push(
      listQueryHref(
        basePath,
        values,
        { pageSize: nextSize, page: undefined },
        defaults,
      ),
    );
  }

  return (
    <nav
      aria-label="Table pagination"
      className="flex flex-wrap items-center justify-between gap-2"
    >
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Showing {firstRow}–{lastRow} of {total}
      </p>

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm">
                {pageSize} / page
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            {pageSizeOptions.map((option) => (
              <DropdownMenuItem
                key={option}
                onClick={() => {
                  changePageSize(String(option));
                }}
              >
                {option} per page
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="outline"
          size="icon-sm"
          aria-label={`Go to page ${String(page - 1)}`}
          disabled={page <= 1}
          onClick={() => {
            goTo(page - 1);
          }}
        >
          <ChevronLeftIcon />
        </Button>
        <span className="text-sm tabular-nums">
          Page {page} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={`Go to page ${String(page + 1)}`}
          disabled={page >= totalPages}
          onClick={() => {
            goTo(page + 1);
          }}
        >
          <ChevronRightIcon />
        </Button>
      </div>
    </nav>
  );
}
