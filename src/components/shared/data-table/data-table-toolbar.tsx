"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  canonicalSearchParams,
  listQueryHref,
  type CanonicalDefaults,
  type CanonicalValues,
} from "@/lib/list-query/canonical";

import type { DataTableSort } from "./data-table";

/**
 * Grid toolbar wired to URL state: debounced search, a slot for faceted
 * filters, column-visibility menu, and reset. All navigation happens through
 * canonical hrefs so the server remains the source of truth.
 */
export function DataTableToolbar({
  basePath,
  values,
  defaults = {},
  searchPlaceholder = "Search…",
  searchDebounceMs = 300,
  columns,
  filterSlot,
}: {
  basePath: string;
  /** Current canonical values parsed from the URL. */
  values: CanonicalValues;
  /** Defaults omitted from hrefs (page=1, pageSize=20, …). */
  defaults?: CanonicalDefaults;
  searchPlaceholder?: string;
  searchDebounceMs?: number;
  /** Toggleable columns: id -> accessible label. */
  columns: Record<string, string>;
  filterSlot?: React.ReactNode;
}) {
  const router = useRouter();
  const [searchDraft, setSearchDraft] = React.useState(
    typeof values.search === "string" ? values.search : "",
  );

  const visibleColumns = React.useMemo(() => {
    const raw = values.columns;

    return typeof raw === "string" ? raw.split(",").filter(Boolean) : null;
  }, [values.columns]);

  function navigate(patch: CanonicalValues): void {
    router.push(listQueryHref(basePath, values, patch, defaults));
  }

  React.useEffect(() => {
    const currentSearch =
      typeof values.search === "string" ? values.search : "";

    if (searchDraft === currentSearch) {
      return;
    }

    const timeout = setTimeout(() => {
      navigate({ search: searchDraft.trim() || undefined, page: undefined });
    }, searchDebounceMs);

    return () => {
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  function toggleColumn(id: string): void {
    const allIds = Object.keys(columns);
    const nextVisible =
      visibleColumns === null
        ? allIds.filter((candidate) => candidate !== id)
        : visibleColumns.includes(id)
          ? visibleColumns.filter((candidate) => candidate !== id)
          : [...visibleColumns, id];

    navigate({
      columns:
        nextVisible.length === allIds.length || nextVisible.length === 0
          ? undefined
          : [...allIds]
              .sort((a, b) => nextVisible.indexOf(a) - nextVisible.indexOf(b))
              .join(","),
    });
  }

  function isColumnVisible(id: string): boolean {
    if (visibleColumns === null) {
      return true;
    }

    return visibleColumns.includes(id);
  }

  function hasActiveState(): boolean {
    return (
      Object.keys(values).some(
        (key) =>
          key !== "page" &&
          key !== "pageSize" &&
          canonicalSearchParams({ [key]: values[key] }).toString() !== "",
      ) &&
      Object.entries(values).some(([key, value]) => {
        if (key === "page" || key === "pageSize" || value === undefined) {
          return false;
        }

        return String(value) !== "";
      })
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="search"
        value={searchDraft}
        placeholder={searchPlaceholder}
        aria-label={searchPlaceholder}
        onChange={(event) => {
          setSearchDraft(event.target.value);
        }}
        className="w-full sm:w-64"
      />

      {filterSlot}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm">
              Columns
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
          {Object.entries(columns).map(([id, label]) => (
            <DropdownMenuCheckboxItem
              key={id}
              checked={isColumnVisible(id)}
              onCheckedChange={() => {
                toggleColumn(id);
              }}
            >
              {label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {hasActiveState() && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const resetPatch: CanonicalValues = {};

            for (const key of Object.keys(values)) {
              if (key !== "pageSize") {
                resetPatch[key] = undefined;
              }
            }

            navigate(resetPatch);
          }}
        >
          Reset
        </Button>
      )}
    </div>
  );
}

export type { DataTableSort };
