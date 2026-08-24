"use client";

import Link from "next/link";
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
import { EmptyState, Money } from "@/components/shared/display";
import { ConfirmationDialog } from "@/components/shared/form-controls";
import { Badge } from "@/components/ui/badge";
import { buttonVariants, Button } from "@/components/ui/button";
import { hasAnyRole } from "@/lib/auth/roles";
import type { RoleKey } from "@/lib/auth/roles";
import type { ActionError } from "@/lib/errors/action-result";
import {
  listQueryHref,
  type CanonicalDefaults,
  type CanonicalValues,
} from "@/lib/list-query/canonical";
import { cn } from "@/lib/utils";

import { setCustomerActiveAction } from "../actions";

import type { CustomerListPage, CustomerListRow } from "../schemas";

const columnHelper = createDataTableColumnHelper<CustomerListRow>();

const DEFAULTS: CanonicalDefaults = {
  page: 1,
  pageSize: 20,
  sort: "name",
  status: "all",
};

const STATUS_LABELS: Record<"all" | "active" | "archived", string> = {
  all: "All",
  active: "Active",
  archived: "Archived",
};

interface ArchiveTarget {
  id: string;
  name: string;
  nextActive: boolean;
}

/**
 * Customers grid bound to URL state. Search, lifecycle status, sorting, and
 * pagination navigate to canonical hrefs; archive/restore is role-gated and
 * confirmed. Rows surface order engagement (count) and recognized sales.
 */
export function CustomersGrid({
  page,
  currentRoles,
  urlValues,
}: {
  page: CustomerListPage;
  currentRoles: RoleKey[];
  urlValues: CanonicalValues;
}) {
  const router = useRouter();
  const [archiveTarget, setArchiveTarget] = React.useState<ArchiveTarget>();
  const [submissionError, setSubmissionError] = React.useState<
    ActionError | undefined
  >(undefined);
  const [isPending, setIsPending] = React.useState(false);

  const canManage = hasAnyRole(currentRoles, ["admin", "sales"]);

  const basePath = "/customers";

  const values = urlValues;

  function hrefFor(patch: CanonicalValues): string {
    return listQueryHref(basePath, values, patch, DEFAULTS);
  }

  function handleSortChange(sort: DataTableSort | null): void {
    if (!sort) {
      return;
    }

    const sortValue = sortValueFor(sort.id, sort.desc);

    if (sortValue) {
      router.push(hrefFor({ sort: sortValue, page: undefined }));
    }
  }

  async function confirmToggle(): Promise<void> {
    if (!archiveTarget) {
      return;
    }

    setIsPending(true);
    setSubmissionError(undefined);

    try {
      const result = await setCustomerActiveAction({
        customerId: archiveTarget.id,
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
              {cell.row.original.companyName !== null && (
                <span className="text-xs text-muted-foreground">
                  {cell.row.original.companyName}
                </span>
              )}
            </div>
          ),
        }),
        columnHelper.accessor("email", {
          header: "Contact",
          cell: (cell) => (
            <div className="flex flex-col">
              <span>{cell.getValue()}</span>
              {cell.row.original.phone !== null && (
                <span className="text-xs text-muted-foreground">
                  {cell.row.original.phone}
                </span>
              )}
            </div>
          ),
        }),
        columnHelper.display({
          id: "location",
          header: "Location",
          cell: (cell) => {
            const row = cell.row.original;

            return (
              <span className="text-sm">
                {[row.city, row.region, row.countryCode]
                  .filter((part) => part !== null && part !== "")
                  .join(", ")}
              </span>
            );
          },
        }),
        columnHelper.accessor("orderCount", {
          id: "orders",
          header: "Orders",
          cell: (cell) => (
            <span className="tabular-nums">{cell.getValue()}</span>
          ),
        }),
        columnHelper.accessor("confirmedSalesCents", {
          id: "confirmedSales",
          header: "Confirmed sales",
          cell: (cell) => (
            <Money amountCents={cell.getValue()} className="text-sm" />
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
            const rowData = cell.row.original;

            if (!canManage) {
              return null;
            }

            return (
              <div className="flex gap-2">
                <Link
                  className={buttonVariants({
                    variant: "outline",
                    size: "sm",
                  })}
                  href={`/customers/${rowData.id}/edit`}
                >
                  Edit
                </Link>
                <Button
                  variant={rowData.isActive ? "destructive" : "outline"}
                  size="sm"
                  onClick={() => {
                    setSubmissionError(undefined);
                    setArchiveTarget({
                      id: rowData.id,
                      name: rowData.name,
                      nextActive: !rowData.isActive,
                    });
                  }}
                >
                  {rowData.isActive ? "Archive" : "Restore"}
                </Button>
              </div>
            );
          },
        }),
      ]),
    [canManage],
  );

  const isEmpty = page.rows.length === 0;
  const hasFilters =
    (values.search ?? "") !== "" ||
    ((values.status ?? DEFAULTS.status) as string) !== DEFAULTS.status;

  return (
    <>
      {canManage && (
        <div className="flex justify-end">
          <Link
            className={buttonVariants({ variant: "default" })}
            href="/customers/new"
          >
            New customer
          </Link>
        </div>
      )}

      <DataTableToolbar
        basePath={basePath}
        values={values}
        defaults={DEFAULTS}
        searchPlaceholder="Search customers"
        columns={{ name: "Name", email: "Email" }}
        filterSlot={
          <nav aria-label="Filter by status" className="flex rounded-md border">
            {(["active", "archived", "all"] as const).map((status) => {
              const isCurrent =
                ((values.status ?? DEFAULTS.status) as string) === status;

              return (
                <Link
                  key={status}
                  aria-current={isCurrent ? "page" : undefined}
                  className={cn(
                    "px-3 py-1.5 text-sm first:rounded-l-md last:rounded-r-md",
                    isCurrent
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted",
                  )}
                  href={hrefFor({ status, page: undefined })}
                >
                  {STATUS_LABELS[status]}
                </Link>
              );
            })}
          </nav>
        }
      />

      {isEmpty && !hasFilters ? (
        <EmptyState
          title="No customers yet"
          description={
            canManage
              ? "Create the first customer to start taking orders."
              : "Customers will appear here once sales sets them up."
          }
        />
      ) : isEmpty && hasFilters ? (
        <EmptyState title="No results" description="" filtered />
      ) : (
        <DataTable
          ariaLabel="Customers"
          columns={columns}
          rows={page.rows}
          sort={sortFromUrl(String(values.sort ?? DEFAULTS.sort))}
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
            archiveTarget.nextActive ? "Restore customer" : "Archive customer"
          }
          description={
            archiveTarget.nextActive
              ? `${archiveTarget.name} can be selected for new orders again.`
              : `${archiveTarget.name} will be hidden from new orders. Existing order history is kept.`
          }
          destructive={!archiveTarget.nextActive}
          confirmLabel={archiveTarget.nextActive ? "Restore" : "Archive"}
          isPending={isPending}
          onConfirm={() => {
            void confirmToggle();
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

function sortValueFor(id: string, desc: boolean): string | null {
  switch (id) {
    case "name":
      return desc ? "name_desc" : "name";
    case "email":
      return desc ? "email_desc" : "email";
    case "createdAt":
      // Newest-first only; oldest-first reads poorly for directories.
      return desc ? "newest" : null;
    default:
      return null;
  }
}

function sortFromUrl(sort: string): DataTableSort | null {
  switch (sort) {
    case "name":
      return { desc: false, id: "name" };
    case "name_desc":
      return { desc: true, id: "name" };
    case "email":
      return { desc: false, id: "email" };
    case "email_desc":
      return { desc: true, id: "email" };
    case "newest":
      return { desc: true, id: "createdAt" };
    default:
      return null;
  }
}
