"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { z } from "zod";

import { ActionErrorAlert } from "@/components/shared/action-error-alert";
import { SubmitButton } from "@/components/shared/form-controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionError } from "@/lib/errors/action-result";

import { adjustStockAction } from "../actions";

/** Form-local validation mirroring the shared server contract. */
const adjustmentFormSchema = z.object({
  quantityDelta: z.coerce
    .number({ message: "Enter a whole number." })
    .int("Enter a whole number.")
    .min(-1_000_000)
    .max(1_000_000)
    .refine((value) => value !== 0, {
      message: "Adjustment cannot be zero.",
    }),
  reason: z.string().trim().min(1, "Enter a reason.").max(500),
});

type AdjustmentFormValues = z.input<typeof adjustmentFormSchema>;

/**
 * Reasoned stock adjustment for one product.  A rejected negative result
 * keeps the dialog open and surfaces the current balance so the operator
 * can correct the delta without losing the draft.
 */
export function StockAdjustmentDialog({
  productId,
  productName,
  currentStock,
  open,
  onOpenChange,
}: {
  productId: string;
  productName: string;
  /** Balance at render time; echoed back on insufficient-stock failures. */
  currentStock: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [submissionError, setSubmissionError] = React.useState<
    ActionError | undefined
  >(undefined);
  const [availableStock, setAvailableStock] = React.useState(currentStock);

  const [values, setValues] = React.useState({
    quantityDelta: "",
    reason: "",
  } satisfies AdjustmentFormValues);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string[]>
  >({});
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  function reset(): void {
    setValues({ quantityDelta: "", reason: "" });
    setFieldErrors({});
    setSubmissionError(undefined);
    setAvailableStock(currentStock);
  }

  async function handleSubmit(event: React.SyntheticEvent): Promise<void> {
    event.preventDefault();
    setSubmissionError(undefined);

    const parsed = adjustmentFormSchema.safeParse(values);
    const parsedErrors: Record<string, string[]> = {};

    if (!parsed.success) {
      const flat = z.flattenError(parsed.error);

      for (const [field, messages] of Object.entries(flat.fieldErrors)) {
        parsedErrors[field] = messages;
      }

      setFieldErrors(parsedErrors);

      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const result = await adjustStockAction({
        productId,
        quantityDelta: parsed.data.quantityDelta,
        reason: parsed.data.reason,
      });

      if (result.ok) {
        onOpenChange(false);
        reset();
        router.refresh();

        return;
      }

      // Rejected adjustments keep the draft and show the live balance so a
      // corrected delta can be submitted immediately.
      setSubmissionError(result.error);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
        }

        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust stock</DialogTitle>
          <DialogDescription>
            Record a reasoned change to the {productName} balance. Current
            stock: <span data-slot="available-stock">{availableStock}</span>{" "}
            units.
          </DialogDescription>
        </DialogHeader>

        {submissionError !== undefined && (
          <ActionErrorAlert error={submissionError} />
        )}

        <form
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="adjustment-delta">Quantity change</Label>
            <Input
              id="adjustment-delta"
              inputMode="numeric"
              placeholder="Use a negative number to remove stock"
              value={values.quantityDelta}
              aria-invalid={
                fieldErrors.quantityDelta !== undefined || undefined
              }
              onChange={(event) => {
                setValues((prev) => ({
                  ...prev,
                  quantityDelta: event.target.value,
                }));
              }}
            />
            {fieldErrors.quantityDelta !== undefined && (
              <p className="text-xs text-destructive" role="alert">
                {fieldErrors.quantityDelta[0]}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="adjustment-reason">Reason</Label>
            <Input
              id="adjustment-reason"
              placeholder="Why is the balance changing?"
              value={values.reason}
              aria-invalid={fieldErrors.reason !== undefined || undefined}
              onChange={(event) => {
                setValues((prev) => ({ ...prev, reason: event.target.value }));
              }}
            />
            {fieldErrors.reason !== undefined && (
              <p className="text-xs text-destructive" role="alert">
                {fieldErrors.reason[0]}
              </p>
            )}
          </div>

          <DialogFooter>
            <SubmitButton pending={isSubmitting}>Apply adjustment</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
