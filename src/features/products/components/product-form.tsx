"use client";

import { useForm } from "@tanstack/react-form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { z } from "zod";

import { ActionErrorAlert } from "@/components/shared/action-error-alert";
import { SubmitButton } from "@/components/shared/form-controls";
import {
  SearchableCombobox,
  type ComboboxOption,
} from "@/components/shared/searchable-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionError } from "@/lib/errors/action-result";

import { createProductAction, updateProductAction } from "../actions";

import type { ProductListRow } from "../schemas";

/** Form-local validation mirroring the shared server contracts. */
const productFormSchema = z.object({
  categoryId: z.string().min(1, "Choose a category."),
  sku: z
    .string()
    .trim()
    .min(1, "Enter a SKU.")
    .max(64, "Keep the SKU under 64 characters."),
  name: z
    .string()
    .trim()
    .min(1, "Enter a name.")
    .max(160, "Keep the name under 160 characters."),
  description: z
    .string()
    .trim()
    .max(2000, "Keep the description under 2000 characters.")
    .optional()
    .transform((value) =>
      value !== undefined && value.length > 0 ? value : undefined,
    ),
  unitPrice: z
    .string()
    .trim()
    .regex(
      /^(0|[1-9]\d{0,10})(\.\d{1,2})?$/,
      "Enter an amount like 12.99 — greater than zero.",
    )
    .refine((value) => Number.parseFloat(value) > 0, {
      message: "Enter an amount like 12.99 — greater than zero.",
    }),
  reorderLevel: z.coerce
    .number({ message: "Enter a whole number." })
    .int("Enter a whole number.")
    .min(0, "Cannot be negative.")
    .max(1_000_000, "Too large."),
  openingStock: z.coerce
    .number({ message: "Enter a whole number." })
    .int("Enter a whole number.")
    .min(0, "Cannot be negative.")
    .max(1_000_000, "Too large."),
});

type ProductFormValues = z.input<typeof productFormSchema>;

/**
 * Create/edit form for products. One component owns both modes so the field
 * contracts stay identical; server validation and unique-SKU conflicts map
 * back onto their fields without losing the draft.
 */
export function ProductForm({
  mode,
  product,
  categoryOptions,
}: {
  mode: "create" | "edit";
  /** Required in edit mode; supplies identity and read-only stock. */
  product?: ProductListRow;
  /** Active categories; empty list renders the prerequisite notice. */
  categoryOptions: ComboboxOption[];
}) {
  const router = useRouter();
  const [submissionError, setSubmissionError] = React.useState<
    ActionError | undefined
  >(undefined);

  const form = useForm({
    defaultValues: {
      categoryId: product?.categoryId ?? "",
      sku: product?.sku ?? "",
      name: product?.name ?? "",
      description: product?.description ?? "",
      unitPrice:
        product !== undefined ? centsToInput(product.unitPriceCents) : "",
      reorderLevel: String(product?.reorderLevel ?? 0),
      openingStock: "0",
    } satisfies ProductFormValues,
    onSubmit: async ({ value }) => {
      setSubmissionError(undefined);

      const parsed = productFormSchema.safeParse(value);
      const fieldErrors: Record<string, string[]> = {};

      if (!parsed.success) {
        const flat = z.flattenError(parsed.error);

        for (const [field, messages] of Object.entries(flat.fieldErrors)) {
          fieldErrors[field] = messages;
        }

        return { fieldErrors };
      }

      function absorb(resultError: ActionError): Record<string, string[]> {
        if (resultError.code === "VALIDATION_ERROR") {
          for (const [field, messages] of Object.entries(
            resultError.fieldErrors ?? {},
          )) {
            fieldErrors[field] = messages;
          }

          return fieldErrors;
        }

        setSubmissionError(resultError);

        return fieldErrors;
      }

      if (mode === "create") {
        const result = await createProductAction({
          categoryId: parsed.data.categoryId,
          sku: parsed.data.sku,
          name: parsed.data.name,
          description: parsed.data.description,
          unitPrice: parsed.data.unitPrice,
          reorderLevel: parsed.data.reorderLevel,
          openingStock: parsed.data.openingStock,
        });

        if (!result.ok) {
          return { fieldErrors: absorb(result.error) };
        }

        router.push("/inventory/products");
        router.refresh();

        return;
      }

      const result = await updateProductAction({
        productId: product?.id ?? "",
        categoryId: parsed.data.categoryId,
        sku: parsed.data.sku,
        name: parsed.data.name,
        description: parsed.data.description,
        unitPrice: parsed.data.unitPrice,
        reorderLevel: parsed.data.reorderLevel,
      });

      if (!result.ok) {
        return { fieldErrors: absorb(result.error) };
      }

      router.push("/inventory/products");
      router.refresh();
    },
  });

  if (categoryOptions.length === 0 && mode === "create") {
    return (
      <div className="rounded-md border p-6 text-center">
        <p className="text-sm font-medium">No active categories yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Products must belong to an active category.
        </p>
        <Link
          className={
            "mt-4 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          }
          href="/inventory/categories"
        >
          Go to categories
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      className="flex max-w-xl flex-col gap-4"
      aria-label={
        mode === "create" ? "New product" : `Edit ${product?.name ?? "product"}`
      }
    >
      {submissionError !== undefined &&
        submissionError.code !== "VALIDATION_ERROR" && (
          <ActionErrorAlert error={submissionError} />
        )}

      <form.Field name="categoryId">
        {(field) => (
          <div className="flex flex-col gap-1">
            <Label htmlFor="product-category">Category</Label>
            <SearchableCombobox
              value={
                categoryOptions.find(
                  (option) => option.id === field.state.value,
                ) ?? null
              }
              onChange={(option) => {
                field.handleChange(option?.id ?? "");
              }}
              loadOptions={(queryText) =>
                Promise.resolve(
                  categoryOptions.filter((option) =>
                    option.label
                      .toLowerCase()
                      .includes(queryText.trim().toLowerCase()),
                  ),
                )
              }
              placeholder="Choose a category…"
              ariaLabel="Category"
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
        name="sku"
        validators={{
          onChange: ({ value }) => {
            const trimmed = value.trim();

            if (trimmed.length === 0) {
              return "Enter a SKU.";
            }

            if (trimmed.length > 64) {
              return "Keep the SKU under 64 characters.";
            }

            return undefined;
          },
        }}
      >
        {(field) => (
          <div className="flex flex-col gap-1">
            <Label htmlFor="product-sku">SKU</Label>
            <Input
              id="product-sku"
              value={field.state.value}
              onBlur={field.handleBlur}
              aria-invalid={field.state.meta.errors.length > 0 || undefined}
              onChange={(event) => {
                field.handleChange(event.target.value.toUpperCase());
              }}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Stored uppercase. Must be unique across all products.
            </p>
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive" role="alert">
                {String(field.state.meta.errors[0])}
              </p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field
        name="name"
        validators={{
          onChange: ({ value }) => {
            const trimmed = value.trim();

            if (trimmed.length === 0) {
              return "Enter a name.";
            }

            if (trimmed.length > 160) {
              return "Keep the name under 160 characters.";
            }

            return undefined;
          },
        }}
      >
        {(field) => (
          <div className="flex flex-col gap-1">
            <Label htmlFor="product-name">Name</Label>
            <Input
              id="product-name"
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
            value.trim().length > 2000
              ? "Keep the description under 2000 characters."
              : undefined,
        }}
      >
        {(field) => (
          <div className="flex flex-col gap-1">
            <Label htmlFor="product-description">Description (optional)</Label>
            <Textarea
              id="product-description"
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

      <div className="grid grid-cols-2 gap-4">
        <form.Field
          name="unitPrice"
          validators={{
            onChange: ({ value }) => {
              const trimmed = value.trim();

              if (
                !/^(0|[1-9]\d{0,10})(\.\d{1,2})?$/.test(trimmed) ||
                Number.parseFloat(trimmed) <= 0
              ) {
                return "Enter an amount like 12.99 — greater than zero.";
              }

              return undefined;
            },
          }}
        >
          {(field) => (
            <div className="flex flex-col gap-1">
              <Label htmlFor="product-unit-price">Unit price</Label>
              <Input
                id="product-unit-price"
                inputMode="decimal"
                placeholder="0.00"
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
          name="reorderLevel"
          validators={{
            onChange: ({ value }) => {
              const parsedValue = Number(value);

              if (!Number.isInteger(parsedValue) || parsedValue < 0) {
                return "Enter a whole number of zero or more.";
              }

              return undefined;
            },
          }}
        >
          {(field) => (
            <div className="flex flex-col gap-1">
              <Label htmlFor="product-reorder-level">Reorder level</Label>
              <Input
                id="product-reorder-level"
                inputMode="numeric"
                type="number"
                min={0}
                step={1}
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
      </div>

      {mode === "edit" ? (
        <div className="flex flex-col gap-1">
          <Label>Stock on hand</Label>
          <p className="text-sm text-muted-foreground tabular-nums">
            {product?.stockOnHand} units — stock changes only through
            adjustments or orders.
          </p>
        </div>
      ) : (
        <form.Field
          name="openingStock"
          validators={{
            onChange: ({ value }) => {
              const parsedValue = Number(value);

              if (!Number.isInteger(parsedValue) || parsedValue < 0) {
                return "Enter a whole number of zero or more.";
              }

              return undefined;
            },
          }}
        >
          {(field) => (
            <div className="flex flex-col gap-1">
              <Label htmlFor="product-opening-stock">
                Opening stock (optional)
              </Label>
              <Input
                id="product-opening-stock"
                inputMode="numeric"
                type="number"
                min={0}
                step={1}
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
      )}

      <div className="flex items-center gap-2">
        <SubmitButton pending={form.state.isSubmitting}>
          {mode === "create" ? "Create product" : "Save changes"}
        </SubmitButton>
        <Button variant="ghost">
          <Link href="/inventory/products">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}
