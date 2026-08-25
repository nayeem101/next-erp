"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { ActionErrorAlert } from "@/components/shared/action-error-alert";
import { ConfirmationDialog } from "@/components/shared/form-controls";
import { Button } from "@/components/ui/button";
import {
  cancelOrderAction,
  confirmOrderAction,
  fulfillOrderAction,
} from "@/features/orders/actions";
import { hasAnyRole } from "@/lib/auth/roles";
import type { RoleKey } from "@/lib/auth/roles";
import type { ActionError } from "@/lib/errors/action-result";

type PendingAction =
  "confirm" | "fulfill" | "cancel-draft" | "cancel-confirmed";

interface OrderStatusActionsProps {
  orderId: string;
  status: "draft" | "confirmed" | "fulfilled" | "cancelled";
  version: number;
  currentRoles: RoleKey[];
}

/**
 * Lifecycle controls for the order detail page. Every destructive or
 * money-moving step runs through an explicit dialog that names its side
 * effects; failures keep the dialog open with the typed error so the user
 * can reload on a stale-version conflict and retry.
 */
export function OrderStatusActions({
  orderId,
  status,
  version,
  currentRoles,
}: OrderStatusActionsProps) {
  const router = useRouter();

  const [pending, setPending] = React.useState<PendingAction | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submissionError, setSubmissionError] = React.useState<
    ActionError | undefined
  >(undefined);

  const canAuthor = hasAnyRole(currentRoles, ["admin", "sales"]);
  const canFulfill = hasAnyRole(currentRoles, ["admin", "inventory"]);

  if (status === "fulfilled" || status === "cancelled") {
    return null;
  }

  async function run(next: PendingAction) {
    if (pending === null) {
      return;
    }

    setIsSubmitting(true);
    setSubmissionError(undefined);

    try {
      const result =
        next === "confirm"
          ? await confirmOrderAction({ orderId, version })
          : next === "fulfill"
            ? await fulfillOrderAction({ orderId, version })
            : // Cancellations flow through CancelWithReasonDialog instead.
              null;

      if (result === null) {
        setIsSubmitting(false);

        return;
      }

      if (result.ok) {
        setPending(null);
        router.refresh();

        return;
      }

      // Keep the dialog open; typed conflicts render below.
      setSubmissionError(result.error);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      {status === "draft" && canAuthor ? (
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              setSubmissionError(undefined);
              setPending("confirm");
            }}
          >
            Confirm order
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              setSubmissionError(undefined);
              setPending("cancel-draft");
            }}
          >
            Cancel draft
          </Button>
        </div>
      ) : null}

      {status === "confirmed" && canAuthor ? (
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            setSubmissionError(undefined);
            setPending("cancel-confirmed");
          }}
        >
          Cancel order
        </Button>
      ) : null}

      {status === "confirmed" && canFulfill ? (
        <Button
          size="sm"
          onClick={() => {
            setSubmissionError(undefined);
            setPending("fulfill");
          }}
        >
          Mark fulfilled
        </Button>
      ) : null}

      {pending === "confirm" ? (
        <ConfirmationDialog
          open
          onOpenChange={(next) => {
            if (!next && !isSubmitting) {
              setPending(null);
            }
          }}
          title="Confirm this order?"
          description="Stock is deducted for every line, an invoice is issued against the customer's current billing details, and a sale journal is posted. This cannot be undone silently — cancelling later reverses all of it."
          confirmLabel="Confirm order"
          isPending={isSubmitting}
          onConfirm={() => {
            void run("confirm");
          }}
        >
          {submissionError !== undefined && (
            <ActionErrorAlert error={submissionError} />
          )}
        </ConfirmationDialog>
      ) : null}

      {pending === "fulfill" ? (
        <ConfirmationDialog
          open
          onOpenChange={(next) => {
            if (!next && !isSubmitting) {
              setPending(null);
            }
          }}
          title="Mark this order fulfilled?"
          description="The order is flagged as delivered. No stock or ledger changes happen now because they were completed at confirmation."
          confirmLabel="Mark fulfilled"
          isPending={isSubmitting}
          onConfirm={() => {
            void run("fulfill");
          }}
        >
          {submissionError !== undefined && (
            <ActionErrorAlert error={submissionError} />
          )}
        </ConfirmationDialog>
      ) : null}

      {(pending === "cancel-draft" || pending === "cancel-confirmed") && (
        <CancelWithReasonDialog
          reversed={pending === "cancel-confirmed"}
          isSubmitting={isSubmitting}
          submissionError={submissionError}
          onClose={() => {
            if (!isSubmitting) {
              setPending(null);
            }
          }}
          onConfirm={(reason) => {
            void (async () => {
              setIsSubmitting(true);
              setSubmissionError(undefined);

              try {
                const result = await cancelOrderAction({
                  orderId,
                  version,
                  reason,
                });

                if (result.ok) {
                  setPending(null);
                  router.refresh();

                  return;
                }

                setSubmissionError(result.error);
              } finally {
                setIsSubmitting(false);
              }
            })();
          }}
        />
      )}
    </>
  );
}

function CancelWithReasonDialog({
  reversed,
  isSubmitting,
  submissionError,
  onClose,
  onConfirm,
}: {
  reversed: boolean;
  isSubmitting: boolean;
  submissionError: ActionError | undefined;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = React.useState("");

  return (
    <ConfirmationDialog
      open
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
      title={reversed ? "Cancel this confirmed order?" : "Cancel this draft?"}
      description={
        reversed
          ? "Stock is restored for every line, the invoice is voided, and a reversal journal is posted to balance the books."
          : "The draft is cancelled cleanly. Nothing was billed or stocked yet."
      }
      destructive={true}
      confirmLabel="Cancel order"
      isPending={isSubmitting}
      onConfirm={() => {
        const trimmed = reason.trim();

        // A reason is mandatory before any cancellation fires.
        if (trimmed === "") {
          return;
        }

        onConfirm(trimmed);
      }}
    >
      <label className="mb-1 block text-sm font-medium" htmlFor="cancel-reason">
        Reason <span className="text-destructive">*</span>
      </label>
      <textarea
        id="cancel-reason"
        value={reason}
        rows={3}
        maxLength={500}
        required
        onChange={(event) => {
          setReason(event.target.value);
        }}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        placeholder="Why is this order being cancelled?"
      />

      {submissionError !== undefined && (
        <ActionErrorAlert error={submissionError} />
      )}
    </ConfirmationDialog>
  );
}
