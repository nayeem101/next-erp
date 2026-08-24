"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { ActionErrorAlert } from "@/components/shared/action-error-alert";
import { ConfirmationDialog } from "@/components/shared/form-controls";
import { buttonVariants } from "@/components/ui/button";
import { hasAnyRole } from "@/lib/auth/roles";
import type { RoleKey } from "@/lib/auth/roles";
import type { ActionError } from "@/lib/errors/action-result";

import { setProductActiveAction } from "../actions";

import type { ProductListRow } from "../schemas";

/**
 * Detail-page status actions: Edit navigation and confirmed Archive/Restore.
 * Restore conflicts (inactive category) surface inline without closing the
 * dialog so the operator can retry after fixing the category.
 */
export function ProductStatusActions({
  product,
  currentRoles,
}: {
  product: ProductListRow;
  currentRoles: RoleKey[];
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [submissionError, setSubmissionError] = React.useState<
    ActionError | undefined
  >(undefined);
  const [isPending, setIsPending] = React.useState(false);

  const canManage = hasAnyRole(currentRoles, ["admin", "inventory"]);

  if (!canManage) {
    return null;
  }

  async function confirmToggle(): Promise<void> {
    setIsPending(true);
    setSubmissionError(undefined);

    try {
      const result = await setProductActiveAction({
        productId: product.id,
        isActive: !product.isActive,
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
    <>
      <div className="flex gap-2">
        <a
          className={buttonVariants({ variant: "outline", size: "sm" })}
          href={`/inventory/products/${product.id}/edit`}
        >
          Edit
        </a>
        <button
          className={buttonVariants({
            variant: product.isActive ? "destructive" : "outline",
            size: "sm",
          })}
          onClick={() => {
            setSubmissionError(undefined);
            setConfirmOpen(true);
          }}
        >
          {product.isActive ? "Archive" : "Restore"}
        </button>
      </div>

      {confirmOpen && (
        <ConfirmationDialog
          open
          onOpenChange={(next) => {
            if (!next) {
              setConfirmOpen(false);
            }
          }}
          title={product.isActive ? "Archive product" : "Restore product"}
          description={
            product.isActive
              ? `${product.sku} will be hidden from new orders. Existing history is kept.`
              : `${product.sku} will reappear in selection lists and order entry.`
          }
          destructive={product.isActive}
          confirmLabel={product.isActive ? "Archive" : "Restore"}
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
