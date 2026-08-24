"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { ActionErrorAlert } from "@/components/shared/action-error-alert";
import {
  createDataTableColumnHelper,
  DataTable,
  type DataTableSort,
} from "@/components/shared/data-table/data-table";
import { DataTablePagination } from "@/components/shared/data-table/data-table-pagination";
import { DataTableToolbar } from "@/components/shared/data-table/data-table-toolbar";
import { EmptyState } from "@/components/shared/display";
import { ConfirmationDialog } from "@/components/shared/form-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { hasAnyRole } from "@/lib/auth/roles";
import type { RoleKey } from "@/lib/auth/roles";
import type { ActionError } from "@/lib/errors/action-result";
import {
  listQueryHref,
  type CanonicalDefaults,
  type CanonicalValues,
} from "@/lib/list-query/canonical";

import { setCategoryActiveAction } from "../actions";

import type { CategoryListPage, CategoryListRow } from "../schemas";

const columnHelper = createDataTableColumnHelper<CategoryListRow>();

export interface CategoriesGridUrlState {
  page: number;
  pageSize: number;
  search: string | undefined;
  sort: string;
  status: "active" | "archived" | "all";
}

const DEFAULTS: CanonicalDefaults = {
  page: 1,
  pageSize: 20,
  sort: "name",
  status: "active",
};

type ArchiveTarget =
  { id: string; name: string; nextActive: boolean } | undefined;

/**
 * Categories grid bound to URL state. Sorting and pagination navigate to
 * canonical hrefs so the server stays the source of truth; row actions are
 * role-gated and confirmed before mutating.
 */
export function CategoriesGrid({
  page,
  currentRoles,
  urlValues,
}: {
  page: CategoryListPage;
  currentRoles: RoleKey[];
  /** Canonical view of the current URL parameters, computed on the server. */
  urlValues: CanonicalValues;
}) {
  const router = useRouter();
  const [archiveTarget, setArchiveTarget] = React.useState<ArchiveTarget>();
  const [submissionError, setSubmissionError] = React.useState<
    ActionError | undefined
  >(undefined);
  const [isPending, setIsPending] = React.useState(false);

  const canManage = hasAnyRole(currentRoles, ["admin", "inventory"]);

  const basePath = "/inventory/categories";

  const values = urlValues;

  function hrefFor(patch: CanonicalValues): string {
    return listQueryHref(basePath, values, patch, DEFAULTS);
  }

  function handleSortChange(sort: DataTableSort | null): void {
    router.push(
      hrefFor(sort ? { sort: sort.desc ? `${sort.id}_desc` : sort.id } : {}),
    );
  }

  async function confirmArchive(): Promise<void> {
    if (!archiveTarget) {
      return;
    }

    setIsPending(true);
    setSubmissionError(undefined);

    try {
      const result = await setCategoryActiveAction({
        categoryId: archiveTarget.id,
        isActive: archiveTarget.nextActive,
      });

      if (result.ok) {
        setArchiveTarget(undefined);
        router.refresh();

        return;
      }

      setSubmissionError(result.error);
    } finally {
      setIsPending(false);
    }
  }

  const columns = React.useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("name", {
          header: "Name",
          cell: (cell) => (
            <div className="flex flex-col">
              <span className="font-medium">{cell.getValue()}</span>
              <span className="text-xs text-muted-foreground">
                /{cell.row.original.slug}
              </span>
            </div>
          ),
        }),
        columnHelper.accessor("description", {
          header: () => <span>Description</span>,
          cell: (cell) => (
            <span className="line-clamp-1 max-w-xs text-sm text-muted-foreground">
              {cell.getValue() ?? "—"}
            </span>
          ),
        }),
        columnHelper.accessor("activeProductCount", {
          header: "Products",
          cell: (cell) => (
            <span className="tabular-nums">{cell.getValue()}</span>
          ),
        }),
        columnHelper.accessor("isActive", {
          header: "Status",
          cell: (cell) =>
            cell.getValue() ? (
              <Badge variant="success">Active</Badge>
            ) : (
              <Badge variant="warning">Archived</Badge>
            ),
        }),
        columnHelper.display({
          id: "actions",
          header: () => <span className="sr-only">Actions</span>,
          cell: (cell) => {
            const row = cell.row.original;

            if (!canManage) {
              return null;
            }

            return (
              <Button
                variant={row.isActive ? "destructive" : "outline"}
                size="sm"
                onClick={() => {
                  setSubmissionError(undefined);
                  setArchiveTarget({
                    id: row.id,
                    name: row.name,
                    nextActive: !row.isActive,
                  });
                }}
              >
                {row.isActive ? "Archive" : "Restore"}
              </Button>
            );
          },
        }),
      ]),
    [canManage],
  );

  const isEmpty = page.rows.length === 0;
  const hasFilters = (values.search ?? "") !== "" || values.status !== "active";

  return (
    <>
      <DataTableToolbar
        basePath={basePath}
        values={values}
        defaults={DEFAULTS}
        searchPlaceholder="Search categories"
        columns={{ name: "Name", description: "Description" }}
      />

      {isEmpty && !hasFilters ? (
        <EmptyState
          title="No categories yet"
          description="Create the first category to start organizing products."
        />
      ) : isEmpty && hasFilters ? (
        <EmptyState title="No results" description="" filtered />
      ) : (
        <DataTable
          ariaLabel="Categories"
          columns={columns}
          rows={page.rows}
          sort={sortFromUrl(String(values.sort ?? "name"))}
          onSortChange={handleSortChange}
        />
      )}

      <DataTablePagination
        basePath={basePath}
        values={values}
        defaults={DEFAULTS}
        total={page.total}
      />

      {archiveTarget !== undefined && (
        <ConfirmationDialog
          open
          onOpenChange={(next) => {
            if (!next) {
              setArchiveTarget(undefined);
            }
          }}
          title={
            archiveTarget.nextActive ? "Restore category" : "Archive category"
          }
          description={
            archiveTarget.nextActive
              ? `${archiveTarget.name} will reappear in selection lists.`
              : `${archiveTarget.name} will be hidden from new products. Existing records keep their history.`
          }
          destructive={!archiveTarget.nextActive}
          confirmLabel={archiveTarget.nextActive ? "Restore" : "Archive"}
          isPending={isPending}
          onConfirm={() => {
            void confirmArchive();
          }}
        >
          {submissionError !== undefined && (
            <ActionErrorAlert error={submissionError} />
          )}
        </ConfirmationDialog>
      )}
    </>
  );
}

function sortFromUrl(sort: string): DataTableSort | null {
  if (sort.endsWith("_desc")) {
    return { desc: true, id: sort.replace(/_desc$/, "") };
  }

  // Only expose sorting on columns the server allowlist supports.
  return ["name", "newest", "most_products"].includes(sort)
    ? { desc: false, id: sort }
    : null;
}
