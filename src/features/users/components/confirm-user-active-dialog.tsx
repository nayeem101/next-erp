"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { ActionErrorAlert } from "@/components/shared/action-error-alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ActionError } from "@/lib/errors/action-result";

import { setUserActiveAction } from "../actions";

import type { UserListRow } from "../schemas";

/**
 * Confirmation gate for enable/disable mutations. The destructive variant
 * explains account impact; last-Admin rejections surface inline so the
 * operator understands why the workspace blocks the change.
 */
export function ConfirmUserActiveDialog({
  user,
  isActive,
  open,
  onOpenChange,
}: {
  user: UserListRow;
  /** The state the action will APPLY (target state, not current). */
  isActive: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [submissionError, setSubmissionError] = React.useState<
    ActionError | undefined
  >(undefined);
  const [isPending, setIsPending] = React.useState(false);

  async function handleConfirm(): Promise<void> {
    setIsPending(true);
    setSubmissionError(undefined);

    try {
      const result = await setUserActiveAction({
        userId: user.id,
        isActive,
      });

      if (result.ok) {
        onOpenChange(false);
        router.refresh();

        return;
      }

      setSubmissionError(result.error);
    } finally {
      setIsPending(false);
    }
  }

  const disabling = !isActive;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {disabling ? "Disable account" : "Enable account"}
          </DialogTitle>
          <DialogDescription>
            {disabling
              ? `${user.displayName} (${user.email}) will immediately lose access to the console. Their identity in Supabase is kept.`
              : `${user.displayName} (${user.email}) will regain access at their next sign-in.`}
          </DialogDescription>
        </DialogHeader>

        {submissionError !== undefined && (
          <ActionErrorAlert error={submissionError} />
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              void handleConfirm();
            }}
            disabled={isPending}
          >
            {isPending
              ? "Working…"
              : disabling
                ? "Disable account"
                : "Enable account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
