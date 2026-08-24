"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import {
  SearchableCombobox,
  type ComboboxOption,
} from "@/components/shared/searchable-combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listQueryHref,
  type CanonicalDefaults,
  type CanonicalValues,
} from "@/lib/list-query/canonical";
import { cn } from "@/lib/utils";

import { StockMovementTable } from "./stock-movement-table";

import type { StockMovementPage } from "../stock-movement-schemas";

const DEFAULTS: CanonicalDefaults = { page: 1, pageSize: 20 };

const TYPE_SEGMENTS = [
  { value: undefined, label: "All" },
  { value: "opening", label: "Opening" },
  { value: "adjustment", label: "Adjustment" },
  { value: "sale", label: "Sale" },
  { value: "sale_reversal", label: "Reversal" },
] as const;

/**
 * Cross-product audit trail.  Every filter is URL-backed so views are
 * shareable; the movement table itself stays strictly read-only because the
 * ledger is append-only.
 */
export function StockMovementsGrid({
  page,
  productOptions,
  actorOptions,
  urlValues,
}: {
  page: StockMovementPage;
  /** Active products for the scope filter (server-fed). */
  productOptions: ComboboxOption[];
  /** Users for the actor filter (server-fed). */
  actorOptions: ComboboxOption[];
  urlValues: CanonicalValues;
}) {
  const router = useRouter();
  const basePath = "/inventory/stock-movements";

  const values = urlValues;

  function hrefFor(patch: CanonicalValues): string {
    return listQueryHref(basePath, values, patch, DEFAULTS);
  }

  function navigate(patch: CanonicalValues): void {
    router.push(hrefFor(patch));
  }

  const selectedProduct = React.useMemo(
    () =>
      typeof values.productId === "string"
        ? (productOptions.find((option) => option.id === values.productId) ??
          null)
        : null,
    [productOptions, values.productId],
  );

  const selectedActor = React.useMemo(
    () =>
      typeof values.actorId === "string"
        ? (actorOptions.find((option) => option.id === values.actorId) ?? null)
        : null,
    [actorOptions, values.actorId],
  );

  // Order-number filter debounces like toolbar search.
  const [orderDraft, setOrderDraft] = React.useState(
    typeof values.orderNumber === "string" ? values.orderNumber : "",
  );
  const [previousOrderParam, setPreviousOrderParam] = React.useState(
    typeof values.orderNumber === "string" ? values.orderNumber : "",
  );

  const canonicalOrder =
    typeof values.orderNumber === "string" ? values.orderNumber : "";

  if (canonicalOrder !== previousOrderParam) {
    setPreviousOrderParam(canonicalOrder);
    setOrderDraft(canonicalOrder);
  }

  React.useEffect(() => {
    if (orderDraft === (values.orderNumber ?? "")) {
      return;
    }

    const timeout = setTimeout(() => {
      navigate({
        orderNumber: orderDraft.trim() || undefined,
        page: undefined,
      });
    }, 300);

    return () => {
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderDraft]);

  const activeType =
    typeof values.type === "string" && values.type !== ""
      ? values.type
      : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div
        aria-label="Movement filters"
        className="flex flex-wrap items-end gap-3 rounded-md border p-3"
        role="group"
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="movement-type">Type</Label>
          <nav aria-label="Filter by type" className="flex rounded-md border">
            {TYPE_SEGMENTS.map((segment) => {
              const isCurrent = activeType === segment.value;

              return (
                <a
                  key={segment.label}
                  aria-current={isCurrent ? "true" : undefined}
                  className={cn(
                    "px-2.5 py-1.5 text-sm first:rounded-l-md last:rounded-r-md",
                    isCurrent
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted",
                  )}
                  href={hrefFor({ type: segment.value, page: undefined })}
                >
                  {segment.label}
                </a>
              );
            })}
          </nav>
        </div>

        <div className="flex flex-col gap-1">
          <Label>Product</Label>
          <SearchableCombobox
            value={selectedProduct}
            onChange={(option) => {
              navigate({ productId: option?.id, page: undefined });
            }}
            loadOptions={(queryText) =>
              Promise.resolve(
                productOptions.filter((option) =>
                  option.label
                    .toLowerCase()
                    .includes(queryText.trim().toLowerCase()),
                ),
              )
            }
            placeholder="All products"
            ariaLabel="Filter by product"
            className="w-56"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label>Actor</Label>
          <SearchableCombobox
            value={selectedActor}
            onChange={(option) => {
              navigate({ actorId: option?.id, page: undefined });
            }}
            loadOptions={(queryText) =>
              Promise.resolve(
                actorOptions.filter((option) =>
                  option.label
                    .toLowerCase()
                    .includes(queryText.trim().toLowerCase()),
                ),
              )
            }
            placeholder="All actors"
            ariaLabel="Filter by actor"
            className="w-52"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="movement-from">From</Label>
          <Input
            className="w-36"
            id="movement-from"
            type="date"
            value={typeof values.from === "string" ? values.from : ""}
            onChange={(event) => {
              navigate({
                from: event.target.value || undefined,
                page: undefined,
              });
            }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="movement-to">To</Label>
          <Input
            className="w-36"
            id="movement-to"
            type="date"
            value={typeof values.to === "string" ? values.to : ""}
            onChange={(event) => {
              navigate({
                to: event.target.value || undefined,
                page: undefined,
              });
            }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="movement-order">Order #</Label>
          <Input
            className="w-40 font-mono"
            id="movement-order"
            placeholder="SO-000123"
            value={orderDraft}
            onChange={(event) => {
              setOrderDraft(event.target.value);
            }}
          />
        </div>
      </div>

      <StockMovementTable
        basePathOverride={basePath}
        productId={typeof values.productId === "string" ? values.productId : ""}
        page={page}
        showProductColumn
        urlValues={values}
      />
    </div>
  );
}
