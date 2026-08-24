"use client";

import { AlertTriangle } from "lucide-react";
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
import {
  SearchableCombobox,
  type ComboboxOption,
} from "@/components/shared/searchable-combobox";
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

import { setProductActiveAction } from "../actions";

import type { ProductListPage, ProductListRow } from "../schemas";

const columnHelper = createDataTableColumnHelper<ProductListRow>();

export interface ProductsGridUrlState {
  page: number;
  pageSize: number;
  search: string | undefined;
  sort: string;
  categoryId: string | undefined;
  stockStatus: "all" | "active" | "archived" | "low_stock";
}

const DEFAULTS: CanonicalDefaults = {
  page: 1,
  pageSize: 20,
  sort: "name",
  stockStatus: "active",
};

const STOCK_STATUS_LABELS: Record<ProductsGridUrlState["stockStatus"], string> =
  {
    active: "Active",
    archived: "Archived",
    all: "All",
    low_stock: "Low stock",
  };

interface ArchiveTarget {
  id: string;
  sku: string;
  nextActive: boolean;
}

/**
 * Products grid bound to URL state. Search, category scope, stock status,
 * sorting, and pagination navigate to canonical hrefs; mutating row actions
 * are role-gated and confirmed.
 */
export function ProductsGrid({
  page,
  currentRoles,
  categoryOptions,
  urlValues,
}: {
  page: ProductListPage;
  currentRoles: RoleKey[];
  /** Active categories for the scope filter (server-fed). */
  categoryOptions: ComboboxOption[];
  urlValues: CanonicalValues;
}) {
  const router = useRouter();
  const [archiveTarget, setArchiveTarget] = React.useState<ArchiveTarget>();
  const [submissionError, setSubmissionError] = React.useState<
    ActionError | undefined
  >(undefined);
  const [isPending, setIsPending] = React.useState(false);

  const canManage = hasAnyRole(currentRoles, ["admin", "inventory"]);

  const basePath = "/inventory/products";

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

  async function confirmArchive(): Promise<void> {
    if (!archiveTarget) {
      return;
    }

    setIsPending(true);
    setSubmissionError(undefined);

    try {
      const result = await setProductActiveAction({
        productId: archiveTarget.id,
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

  const selectedCategory = React.useMemo(
    () =>
      typeof values.categoryId === "string"
        ? (categoryOptions.find((option) => option.id === values.categoryId) ??
          null)
        : null,
    [categoryOptions, values.categoryId],
  );

  const columns = React.useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("sku", {
          header: "SKU",
          cell: (cell) => (
            <span className="font-mono text-xs">{cell.getValue()}</span>
          ),
        }),
        columnHelper.accessor("name", {
          header: "Name",
          cell: (cell) => (
            <div className="flex flex-col">
              <span className="font-medium">{cell.getValue()}</span>
              <span className="text-xs text-muted-foreground">
                {cell.row.original.categoryName}
              </span>
            </div>
          ),
        }),
        columnHelper.accessor("unitPriceCents", {
          id: "price",
          header: "Unit price",
          cell: (cell) => (
            <Money amountCents={cell.getValue()} className="text-sm" />
          ),
        }),
        columnHelper.accessor("stockOnHand", {
          id: "stock",
          header: "Stock",
          cell: (cell) => {
            const row = cell.row.original;
            const isLow = row.isActive && row.stockOnHand <= row.reorderLevel;

            return (
              <span
                className={cn(
                  "flex items-center gap-1.5 tabular-nums",
                  isLow && "text-destructive",
                )}
              >
                {isLow && <AlertTriangle aria-hidden className="size-3.5" />}
                <span>{row.stockOnHand}</span>
                {isLow && <span className="sr-only">(low stock)</span>}
              </span>
            );
          },
        }),
        columnHelper.accessor("reorderLevel", {
          header: "Reorder at",
          cell: (cell) => (
            <span className="text-muted-foreground tabular-nums">
              {cell.getValue()}
            </span>
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
                  href={`/inventory/products/${rowData.id}/edit`}
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
                      sku: rowData.sku,
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
    values.stockStatus !== DEFAULTS.stockStatus ||
    values.categoryId !== undefined;

  return (
    <>
      {canManage && (
        <div className="flex justify-end">
          <Link
            className={buttonVariants({ variant: "default" })}
            href="/inventory/products/new"
          >
            New product
          </Link>
        </div>
      )}

      <DataTableToolbar
        basePath={basePath}
        values={values}
        defaults={DEFAULTS}
        searchPlaceholder="Search products"
        columns={{ name: "Name", sku: "SKU", price: "Unit price" }}
        filterSlot={
          <div className="flex flex-wrap items-center gap-2">
            <nav
              aria-label="Filter by stock status"
              className="flex rounded-md border"
            >
              {(["active", "low_stock", "archived", "all"] as const).map(
                (status) => {
                  const isCurrent =
                    (values.stockStatus ?? DEFAULTS.stockStatus) === status;

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
                      href={hrefFor({ stockStatus: status, page: undefined })}
                    >
                      {STOCK_STATUS_LABELS[status]}
                    </Link>
                  );
                },
              )}
            </nav>

            <SearchableCombobox
              value={selectedCategory}
              onChange={(option) => {
                router.push(
                  hrefFor({
                    categoryId: option?.id,
                    page: undefined,
                  }),
                );
              }}
              loadOptions={(queryText) =>
                Promise.resolve(
                  categoryOptions.filter((option) =>
                    option.label
                      .toLowerCase()
                      .includes(queryText.trim().toLowerCase()),
                  ),
                )
              }
              placeholder="All categories"
              ariaLabel="Filter by category"
              className="w-56"
            />
          </div>
        }
      />

      {isEmpty && !hasFilters ? (
        <EmptyState
          title="No products yet"
          description={
            canManage
              ? "Create the first product to start tracking stock."
              : "Products will appear here once inventory is set up."
          }
        />
      ) : isEmpty && hasFilters ? (
        <EmptyState title="No results" description="" filtered />
      ) : (
        <DataTable
          ariaLabel="Products"
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
            archiveTarget.nextActive ? "Restore product" : "Archive product"
          }
          description={
            archiveTarget.nextActive
              ? `${archiveTarget.sku} will reappear in selection lists and order entry.`
              : `${archiveTarget.sku} will be hidden from new orders. Existing history is kept.`
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

function sortValueFor(id: string, desc: boolean): string | null {
  switch (id) {
    case "name":
      return desc ? "name_desc" : "name";
    case "sku":
      // Allowlist only exposes ascending SKU order.
      return desc ? null : "sku";
    case "price":
      return desc ? "price_desc" : "price_asc";
    case "stock":
      // Low-stock review reads best smallest-first.
      return desc ? null : "stock_asc";
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
    case "sku":
      return { desc: false, id: "sku" };
    case "price_asc":
      return { desc: false, id: "price" };
    case "price_desc":
      return { desc: true, id: "price" };
    case "stock_asc":
      return { desc: false, id: "stock" };
    default:
      return null;
  }
}
