"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useStore } from "zustand";

import { updateDraftOrderAction } from "@/features/orders/actions";
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

export interface EditableDraft {
  orderId: string;
  version: number;
  customerId: string;
  customerName: string | null;
  notes: string;
  lines: {
    productId: string;
    sku: string;
    name: string;
    unitPriceCents: number;
    quantity: number;
  }[];
}

/**
 * Edit Draft wizard. Hydrates the store once from the server draft, then
 * behaves like the new-order wizard except the save submits ID + version
 * for optimistic concurrency. A conflict keeps every local edit on screen
 * so nothing is lost while the user reloads.
 */
export function EditDraftWizard({
  draft,
  customerOptions,
  productOptions,
}: {
  draft: EditableDraft;
  customerOptions: ActiveCustomerOption[];
  productOptions: ActiveProductOption[];
}) {
  const router = useRouter();

  const [store] = useState(() => {
    const wizard = createOrderWizardStore();
    wizard.getState().hydrateDraft(draft);

    return wizard;
  });

  // The authoritative version travels outside the wizard steps; failed
  // saves do not change it because the server did not advance either.
  const [version] = useState(draft.version);

  const stepIndex = useStore(store, (state) => state.stepIndex);

  async function handleSave(): Promise<ActionResult<{ version: number }>> {
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

    const result = await updateDraftOrderAction({
      orderId: draft.orderId,
      version,
      customerId: state.customerId,
      lines: state.lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
      })),
      notes: state.notes === "" ? undefined : state.notes,
    });

    if (result.ok) {
      // Local edits are now server state; drop transient buffers while
      // navigating to the refreshed draft.
      store.getState().reset();
      router.push(`/sales/orders/${draft.orderId}`);
    }
    // Failures (including version conflicts) return to the review step,
    // which renders the alert and preserves every local input.

    return result;
  }

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
          saveLabel="Save changes"
        />
      ) : null}
    </WizardShell>
  );
}
