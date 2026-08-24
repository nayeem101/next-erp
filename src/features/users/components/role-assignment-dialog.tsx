"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { ActionErrorAlert } from "@/components/shared/action-error-alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ROLE_KEYS } from "@/lib/auth/roles";
import type { ActionError } from "@/lib/errors/action-result";

import { setUserRolesAction } from "../actions";

import type { UserListRow } from "../schemas";

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  inventory: "Inventory",
  sales: "Sales",
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin: "Full access including user and audit administration.",
  inventory: "Products, stock levels, and movements.",
  sales: "Customers, orders, and invoices.",
};

/**
 * Replaces a user's role set through `setUserRolesAction`. The parent mounts
 * this dialog only while open, so state initializes from persisted roles on
 * every opening rather than carrying prior unsaved edits.
 */
export function RoleAssignmentDialog({
  user,
  open,
  onOpenChange,
}: {
  user: UserListRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(user.roles),
  );
  const [submissionError, setSubmissionError] = React.useState<
    ActionError | undefined
  >(undefined);
  const [isPending, setIsPending] = React.useState(false);

  function toggle(role: string, checked: boolean): void {
    setSelected((previous) => {
      const next = new Set(previous);

      if (checked) {
        next.add(role);
      } else {
        next.delete(role);
      }

      return next;
    });
  }

  async function submit(): Promise<void> {
    setIsPending(true);
    setSubmissionError(undefined);

    try {
      const result = await setUserRolesAction({
        userId: user.id,
        roles: ROLE_KEYS.filter((role) => selected.has(role)),
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

  function handleSubmit(event: React.SubmitEvent): void {
    event.preventDefault();
    void submit();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage roles</DialogTitle>
          <DialogDescription>
            Update application access for {user.email}. Changes apply at the
            next sign-in.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {submissionError !== undefined && (
            <ActionErrorAlert error={submissionError} />
          )}

          <fieldset className="flex flex-col gap-3" disabled={isPending}>
            <legend className="sr-only">Assigned roles</legend>

            {ROLE_KEYS.map((role) => {
              const checked = selected.has(role);

              return (
                <div key={role} className="flex items-start gap-3">
                  <Checkbox
                    id={`role-${role}`}
                    checked={checked}
                    onCheckedChange={(nextChecked) => {
                      toggle(role, nextChecked);
                    }}
                  />
                  <div className="flex flex-col gap-0.5">
                    <Label htmlFor={`role-${role}`}>{ROLE_LABELS[role]}</Label>
                    <span className="text-xs text-muted-foreground">
                      {ROLE_DESCRIPTIONS[role]}
                    </span>
                  </div>
                </div>
              );
            })}
          </fieldset>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Save roles"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
