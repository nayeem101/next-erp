"use client";

import { useForm } from "@tanstack/react-form";
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
import { Textarea } from "@/components/ui/textarea";
import type { ActionError } from "@/lib/errors/action-result";

import { createCategoryAction, updateCategoryAction } from "../actions";

import type { CategoryListRow } from "../schemas";

/** Form-local validation mirroring the shared server contracts. */
const categoryFormSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(100),
  description: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((value) =>
      value !== undefined && value.length > 0 ? value : undefined,
    ),
});

type CategoryFormValues = z.input<typeof categoryFormSchema>;

/**
 * Create/edit gate for categories. One component owns both modes so the
 * field contracts stay identical; server conflicts render inline above the
 * actions so the operator can correct without losing the draft.
 */
export function CategoryFormDialog({
  mode,
  category,
  open,
  onOpenChange,
}: {
  mode: "create" | "edit";
  category?: CategoryListRow | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [submissionError, setSubmissionError] = React.useState<
    ActionError | undefined
  >(undefined);

  const form = useForm({
    defaultValues: {
      name: category?.name ?? "",
      description: category?.description ?? "",
    } satisfies CategoryFormValues,
    onSubmit: async ({ value }) => {
      setSubmissionError(undefined);

      const parsed = categoryFormSchema.safeParse(value);
      const fieldErrors: Record<string, string[]> = {};

      if (!parsed.success) {
        const flat = z.flattenError(parsed.error);

        for (const [field, messages] of Object.entries(flat.fieldErrors)) {
          fieldErrors[field] = messages;
        }

        return { fieldErrors };
      }

      const result =
        mode === "create"
          ? await createCategoryAction({
              name: parsed.data.name,
              description: parsed.data.description,
            })
          : await updateCategoryAction({
              categoryId: category?.id ?? "",
              name: parsed.data.name,
              description: parsed.data.description,
            });

      if (result.ok) {
        onOpenChange(false);
        router.refresh();

        return;
      }

      if (result.error.code === "VALIDATION_ERROR") {
        for (const [field, messages] of Object.entries(
          result.error.fieldErrors ?? {},
        )) {
          fieldErrors[field] = messages;
        }
      }

      setSubmissionError(result.error);

      return { fieldErrors };
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "New category" : "Edit category"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Categories group products for browsing and reporting."
              : `Update details for ${category?.name ?? "this category"}.`}
          </DialogDescription>
        </DialogHeader>

        {submissionError !== undefined && (
          <ActionErrorAlert error={submissionError} />
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
          className="flex flex-col gap-4"
        >
          <form.Field
            name="name"
            validators={{
              onChange: ({ value }) => {
                const trimmed = value.trim();

                if (trimmed.length === 0) {
                  return "Enter a name.";
                }

                if (trimmed.length > 100) {
                  return "Keep the name under 100 characters.";
                }

                return undefined;
              },
            }}
          >
            {(field) => (
              <div className="flex flex-col gap-1">
                <Label htmlFor="category-name">Name</Label>
                <Input
                  id="category-name"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  aria-invalid={field.state.meta.errors.length > 0 || undefined}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-xs text-destructive" role="alert">
                    {String(field.state.meta.errors[0])}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          <form.Field
            name="description"
            validators={{
              onChange: ({ value }) =>
                value.trim().length > 1000
                  ? "Keep the description under 1000 characters."
                  : undefined,
            }}
          >
            {(field) => (
              <div className="flex flex-col gap-1">
                <Label htmlFor="category-description">
                  Description (optional)
                </Label>
                <Textarea
                  id="category-description"
                  rows={3}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                />
              </div>
            )}
          </form.Field>

          <DialogFooter>
            <SubmitButton pending={form.state.isSubmitting}>
              {mode === "create" ? "Create category" : "Save changes"}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
