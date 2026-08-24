"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { ActionErrorAlert } from "@/components/shared/action-error-alert";
import { ConfirmationDialog } from "@/components/shared/form-controls";
import { buttonVariants } from "@/components/ui/button";
import { hasAnyRole } from "@/lib/auth/roles";
import type { RoleKey } from "@/lib/auth/roles";
import type { ActionError } from "@/lib/errors/action-result";

import { setCustomerActiveAction } from "../actions";

import type { CustomerDetailRow } from "../schemas";

/**
 * Detail-page status actions: Edit navigation and confirmed Archive/Restore.
 * Conflicts surface inline without closing the dialog so the operator can
 * retry after resolving the issue.
 */
export function CustomerStatusActions({
  customer,
  currentRoles,
}: {
  customer: CustomerDetailRow;
  currentRoles: RoleKey[];
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [submissionError, setSubmissionError] = React.useState<
    ActionError | undefined
  >(undefined);
  const [isPending, setIsPending] = React.useState(false);

  const canManage = hasAnyRole(currentRoles, ["admin", "sales"]);

  if (!canManage) {
    return null;
  }

  async function confirmToggle(): Promise<void> {
    setIsPending(true);
    setSubmissionError(undefined);

    try {
      const result = await setCustomerActiveAction({
        customerId: customer.id,
        isActive: !customer.isActive,
      });

      if (result.ok) {
        setConfirmOpen(false);
        router.refresh();

        return;
      }

      setSubmissionError(result.error);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="flex gap-2">
      <Link
        className={buttonVariants({ variant: "outline", size: "sm" })}
        href={`/customers/${customer.id}/edit`}
      >
        Edit
      </Link>

      {customer.isActive ? (
        <button
          className={buttonVariants({ variant: "destructive", size: "sm" })}
          onClick={() => {
            setSubmissionError(undefined);
            setConfirmOpen(true);
          }}
        >
          Archive
        </button>
      ) : (
        <button
          className={buttonVariants({ variant: "outline", size: "sm" })}
          onClick={() => {
            setSubmissionError(undefined);
            setConfirmOpen(true);
          }}
        >
          Restore
        </button>
      )}

      {confirmOpen && (
        <ConfirmationDialog
          open
          onOpenChange={(next) => {
            if (!next) {
              setConfirmOpen(false);
            }
          }}
          title={customer.isActive ? "Archive customer" : "Restore customer"}
          description={
            customer.isActive
              ? `${customer.name} will be hidden from new orders. Existing order history is kept.`
              : `${customer.name} can be selected for new orders again.`
          }
          destructive={customer.isActive}
          confirmLabel={customer.isActive ? "Archive" : "Restore"}
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
    </div>
  );
}
