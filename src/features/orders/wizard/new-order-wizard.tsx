"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useStore } from "zustand";

import { createDraftOrderAction } from "@/features/orders/actions";
import type {
  ActiveCustomerOption,
  ActiveProductOption,
} from "@/features/orders/selectors";
import { CustomerStep } from "@/features/orders/wizard/customer-step";
import { LineItemsStep } from "@/features/orders/wizard/line-items-step";
import { ReviewStep } from "@/features/orders/wizard/review-step";
import { createOrderWizardStore } from "@/features/orders/wizard/store";
import { WizardShell } from "@/features/orders/wizard/wizard-shell";
import type { ActionResult } from "@/lib/errors/action-result";

/**
 * New Order wizard. The store instance lives for this mount only; on a
 * successful save the transient state resets before navigating so a
 * back-navigation starts fresh instead of resurrecting the saved order.
 */
export function NewOrderWizard({
  customerOptions,
  productOptions,
}: {
  customerOptions: ActiveCustomerOption[];
  productOptions: ActiveProductOption[];
}) {
  const router = useRouter();

  // One store instance per mount: two wizards never share transient state.
  const [store] = useState(() => createOrderWizardStore());

  const stepIndex = useStore(store, (state) => state.stepIndex);
  const [pending, setPending] = useState(false);

  const handleSave = useMemo(
    () => async (): Promise<ActionResult<{ orderId: string }>> => {
      const state = store.getState();

      if (state.customerId === null) {
        return {
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Choose a customer before saving.",
          },
        };
      }

      setPending(true);

      const result = await createDraftOrderAction({
        customerId: state.customerId,
        lines: state.lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
        })),
        notes: state.notes === "" ? undefined : state.notes,
      });

      setPending(false);

      if (result.ok) {
        // Success only: clear transient wizard state, then navigate.
        store.getState().reset();
        router.push(`/sales/orders/${result.data.orderId}`);
      }

      return result;
    },
    [store, router],
  );

  return (
    <WizardShell store={store}>
      {stepIndex === 0 ? (
        <CustomerStep store={store} options={customerOptions} />
      ) : null}
      {stepIndex === 1 ? (
        <LineItemsStep store={store} options={productOptions} />
      ) : null}
      {stepIndex === 2 ? (
        <ReviewStep
          store={store}
          onSave={handleSave}
          saveLabel={pending ? "Saving…" : "Save draft"}
        />
      ) : null}
    </WizardShell>
  );
}
