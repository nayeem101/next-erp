"use client";

import { PlusIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";
import { useStore } from "zustand";

import { Money } from "@/components/shared/display";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { wizardTotalCents } from "./store";

import type { OrderWizardStore } from "./store";
import type { ActiveProductOption } from "../selectors";

/**
 * Wizard step 2: build the order lines. Rows are unique per product;
 * quantity edits and removals flow through the store. Stock is shown as
 * context only — availability is enforced later at confirmation.
 */

function clampQuantity(value: number): number {
  return Math.min(Math.max(Math.trunc(value), 1), 1000000);
}

/**
 * Draft-while-typing quantity field. Commits on blur or Enter so clearing
 * the field never snaps mid-edit and partial input is preserved.
 */
function QuantityCell({
  lineName,
  quantity,
  onCommit,
}: {
  lineName: string;
  quantity: number;
  onCommit: (quantity: number) => void;
}) {
  const [draft, setDraft] = useState(String(quantity));
  const [syncedQuantity, setSyncedQuantity] = useState(quantity);

  // Render-time sync: follow external changes (re-add bumping a row)
  // without fighting in-progress typing.
  if (quantity !== syncedQuantity) {
    setSyncedQuantity(quantity);
    setDraft(String(quantity));
  }

  function commit() {
    const parsed = Number(draft);

    if (!Number.isNaN(parsed) && draft.trim() !== "") {
      onCommit(clampQuantity(parsed));
    } else {
      setDraft(String(quantity));
    }
  }

  return (
    <input
      type="number"
      min={1}
      max={1000000}
      aria-label={`Quantity for ${lineName}`}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={() => {
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          event.currentTarget.blur();
        }
      }}
      className="w-20 rounded-md border border-input bg-background px-2 py-1 text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    />
  );
}

export function LineItemsStep({
  store,
  options,
}: {
  store: OrderWizardStore;
  options: ActiveProductOption[];
}) {
  const lines = useStore(store, (state) => state.lines);
  const addProduct = useStore(store, (state) => state.addProduct);
  const updateQuantity = useStore(store, (state) => state.updateQuantity);
  const removeLine = useStore(store, (state) => state.removeLine);

  const [productId, setProductId] = useState("");
  const selectId = useId();

  const totalCents = wizardTotalCents(lines);

  function handleAdd() {
    const product = options.find((option) => option.id === productId);

    if (!product) {
      return;
    }

    addProduct(product);
    setProductId("");
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={selectId} className="mb-2 block text-sm font-medium">
          Product
        </label>

        <div className="flex gap-2">
          <select
            id={selectId}
            value={productId}
            onChange={(event) => {
              setProductId(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleAdd();
              }
            }}
            className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <option value="">
              {options.length > 0
                ? "Select a product to add"
                : "No active products available"}
            </option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} ({option.sku})
              </option>
            ))}
          </select>
          <Button
            type="button"
            onClick={() => {
              handleAdd();
            }}
            disabled={productId === ""}
          >
            <PlusIcon className="size-4" aria-hidden={true} />
            Add
          </Button>
        </div>
      </div>

      {lines.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No products added yet. Pick a product above to start the order.
        </p>
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">Order line items</caption>
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th scope="col" className="py-2 font-medium">
                Product
              </th>
              <th scope="col" className="py-2 font-medium">
                Unit price
              </th>
              <th scope="col" className="py-2 font-medium">
                Qty
              </th>
              <th scope="col" className="py-2 font-medium">
                Stock
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Line total
              </th>
              <th scope="col" className="py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const option = options.find(
                (candidate) => candidate.id === line.productId,
              );
              const stockOnHand = option?.stockOnHand ?? null;
              const overStock =
                stockOnHand !== null && line.quantity > stockOnHand;

              return (
                <tr key={line.key} className="border-b border-border/60">
                  <td className="py-3 pr-4">
                    <span className="block font-medium">{line.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {line.sku}
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    <Money amountCents={line.unitPriceCents} />
                  </td>
                  <td className="py-3 pr-4">
                    <QuantityCell
                      lineName={line.name}
                      quantity={line.quantity}
                      onCommit={(quantity) => {
                        updateQuantity(line.key, quantity);
                      }}
                    />
                  </td>
                  <td className="py-3 pr-4">
                    {stockOnHand === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1",
                          overStock && "font-medium text-amber-600",
                        )}
                      >
                        {overStock ? (
                          <TriangleAlertIcon
                            className="size-4"
                            aria-hidden={true}
                          />
                        ) : null}
                        <span>{stockOnHand} in stock</span>
                        {overStock ? (
                          <span className="sr-only">
                            (exceeds current stock)
                          </span>
                        ) : null}
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-right">
                    <Money
                      amountCents={Number(
                        BigInt(line.quantity) * BigInt(line.unitPriceCents),
                      )}
                    />
                  </td>
                  <td className="py-3 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${line.name}`}
                      onClick={() => {
                        removeLine(line.key);
                      }}
                    >
                      <Trash2Icon className="size-4" aria-hidden={true} />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="pt-3 text-right font-medium">
                Total
              </td>
              <td className="pt-3 text-right font-semibold">
                <Money amountCents={Number(totalCents)} />
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
