"use client";

import { TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { useStore } from "zustand";

import { ActionErrorAlert } from "@/components/shared/action-error-alert";
import { Money } from "@/components/shared/display";
import { Button } from "@/components/ui/button";
import type { ActionResult, ActionError } from "@/lib/errors/action-result";

import { wizardTotalCents } from "./store";

import type { OrderWizardStore } from "./store";

/**
 * Wizard step 3: notes plus a final look before saving. The server
 * re-snapshots prices at save time — the wizard only warns about what it
 * can see locally (over-stock lines). Failed saves keep every input so the
 * user can retry without retyping anything.
 */

export function ReviewStep({
  store,
  onSave,
  saveLabel = "Save draft",
}: {
  store: OrderWizardStore;
  onSave: () => Promise<ActionResult<unknown>>;
  saveLabel?: string;
}) {
  const customerId = useStore(store, (state) => state.customerId);
  const customerName = useStore(store, (state) => state.customerName);
  const lines = useStore(store, (state) => state.lines);
  const notes = useStore(store, (state) => state.notes);
  const setNotes = useStore(store, (state) => state.setNotes);
  const setSubmitting = useStore(store, (state) => state.setSubmitting);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);

  const totalCents = wizardTotalCents(lines);

  async function handleSave() {
    setSaving(true);
    setSubmitting(true);
    setError(null);

    try {
      const result = await onSave();

      if (!result.ok) {
        // Keep all wizard state so the user can correct and retry.
        setSubmitting(false);
        setError(result.error);
      }
      // On success the page navigates away; transient state resets there.
    } catch {
      setSubmitting(false);
      setError({
        code: "INTERNAL_ERROR",
        message: "Something went wrong while saving. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {error ? <ActionErrorAlert error={error} /> : null}

      <dl className="grid gap-x-8 gap-y-2 rounded-lg border border-border bg-muted/30 p-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted-foreground">Customer</dt>
          <dd className="font-medium">{customerName ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Line items</dt>
          <dd className="font-medium tabular-nums">
            {lines.length} {lines.length === 1 ? "product" : "products"}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-sm text-muted-foreground">Estimated total</dt>
          <dd className="text-lg font-semibold">
            <Money amountCents={Number(totalCents)} />
          </dd>
        </div>
      </dl>

      {customerId === null ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          No customer selected. Go back to step 1 and choose one before saving.
        </p>
      ) : null}

      <div>
        <h3 className="mb-2 text-sm font-medium">Order lines</h3>
        <ul className="space-y-1 text-sm">
          {lines.map((line) => (
            <li
              key={line.key}
              className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-1"
            >
              <span>
                {line.name}{" "}
                <span className="text-muted-foreground">
                  ({line.sku}) × {line.quantity}
                </span>
              </span>
              <span className="tabular-nums">
                <Money
                  amountCents={Number(
                    BigInt(line.quantity) * BigInt(line.unitPriceCents),
                  )}
                />
              </span>
            </li>
          ))}
          {lines.length === 0 ? (
            <li className="text-muted-foreground">
              No products yet. Go back to step 2 and add some.
            </li>
          ) : null}
        </ul>
      </div>

      <p className="flex items-start gap-2 rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        <TriangleAlertIcon
          className="mt-0.5 size-4 shrink-0"
          aria-hidden={true}
        />
        <span>
          Prices and product details are snapshotted from current master data
          when you save. Stock is checked again at confirmation.
        </span>
      </p>

      <div>
        <label htmlFor="order-notes" className="mb-2 block text-sm font-medium">
          Notes for this order{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="order-notes"
          value={notes}
          maxLength={500}
          rows={3}
          onChange={(event) => {
            setNotes(event.target.value);
          }}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          placeholder="Delivery instructions, references, or anything the team should know."
        />
      </div>

      <Button type="button" onClick={() => void handleSave()} disabled={saving}>
        {saving ? "Saving…" : saveLabel}
      </Button>
    </div>
  );
}
