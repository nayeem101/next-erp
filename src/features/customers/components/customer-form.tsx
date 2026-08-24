"use client";

import { useForm } from "@tanstack/react-form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { z } from "zod";

import { ActionErrorAlert } from "@/components/shared/action-error-alert";
import { SubmitButton } from "@/components/shared/form-controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionError } from "@/lib/errors/action-result";

import { createCustomerAction, updateCustomerAction } from "../actions";

import type { CustomerDetailRow } from "../schemas";

/** Form-local validation mirroring the shared server contracts. */
const customerFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a name.")
    .max(160, "Keep the name under 160 characters."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Enter an email address.")
    .max(320, "Keep the email under 320 characters.")
    .refine(
      (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
      "Enter a valid email address.",
    ),
  phone: z.string().trim().max(40, "Keep the phone under 40 characters."),
  companyName: z
    .string()
    .trim()
    .max(160, "Keep the company under 160 characters."),
  addressLine1: z
    .string()
    .trim()
    .min(1, "Enter an address line.")
    .max(160, "Keep the address under 160 characters."),
  addressLine2: z
    .string()
    .trim()
    .max(160, "Keep the address under 160 characters."),
  city: z
    .string()
    .trim()
    .min(1, "Enter a city.")
    .max(100, "Keep the city under 100 characters."),
  region: z.string().trim().max(100, "Keep the region under 100 characters."),
  postalCode: z
    .string()
    .trim()
    .min(1, "Enter a postal code.")
    .max(24, "Keep the postal code under 24 characters."),
  countryCode: z
    .string()
    .trim()
    .length(2, "Use a two-letter country code like US."),
  notes: z.string().trim().max(2000, "Keep the notes under 2000 characters."),
});

type CustomerFormValues = z.input<typeof customerFormSchema>;

function FieldGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-4 rounded-md border p-4">
      <legend className="px-1 text-sm font-medium text-muted-foreground">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

/**
 * Create/edit form for customers. One component owns both modes so the
 * field contracts stay identical; server validation and duplicate-email
 * conflicts map back onto their fields without losing the draft.
 */
export function CustomerForm({
  mode,
  customer,
}: {
  mode: "create" | "edit";
  /** Required in edit mode; supplies identity and archived copy context. */
  customer?: CustomerDetailRow;
}) {
  const router = useRouter();
  const [submissionError, setSubmissionError] = React.useState<
    ActionError | undefined
  >(undefined);

  const form = useForm({
    defaultValues: {
      name: customer?.name ?? "",
      email: customer?.email ?? "",
      phone: customer?.phone ?? "",
      companyName: customer?.companyName ?? "",
      addressLine1: customer?.addressLine1 ?? "",
      addressLine2: customer?.addressLine2 ?? "",
      city: customer?.city ?? "",
      region: customer?.region ?? "",
      postalCode: customer?.postalCode ?? "",
      countryCode: customer?.countryCode ?? "",
      notes: customer?.notes ?? "",
    } satisfies CustomerFormValues,
    onSubmit: async ({ value }) => {
      setSubmissionError(undefined);

      const parsed = customerFormSchema.safeParse(value);
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

      const shared = {
        name: parsed.data.name,
        email: parsed.data.email,
        phone: parsed.data.phone === "" ? undefined : parsed.data.phone,
        companyName:
          parsed.data.companyName === "" ? undefined : parsed.data.companyName,
        addressLine1: parsed.data.addressLine1,
        addressLine2:
          parsed.data.addressLine2 === ""
            ? undefined
            : parsed.data.addressLine2,
        city: parsed.data.city,
        region: parsed.data.region === "" ? undefined : parsed.data.region,
        postalCode: parsed.data.postalCode,
        countryCode: parsed.data.countryCode,
        notes: parsed.data.notes === "" ? undefined : parsed.data.notes,
      };

      if (mode === "create") {
        const result = await createCustomerAction(shared);

        if (!result.ok) {
          return { fieldErrors: absorb(result.error) };
        }

        router.push("/customers");
        router.refresh();

        return;
      }

      const result = await updateCustomerAction({
        customerId: customer?.id ?? "",
        ...shared,
      });

      if (!result.ok) {
        return { fieldErrors: absorb(result.error) };
      }

      router.push("/customers");
      router.refresh();
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      className="flex max-w-xl flex-col gap-4"
      aria-label={
        mode === "create"
          ? "New customer"
          : `Edit ${customer?.name ?? "customer"}`
      }
    >
      {submissionError !== undefined &&
        submissionError.code !== "VALIDATION_ERROR" && (
          <ActionErrorAlert error={submissionError} />
        )}

      {mode === "edit" && customer?.isActive === false && (
        <p className="rounded-md border border-warning bg-warning/10 p-3 text-sm">
          This customer is archived — edits are allowed, but new orders require
          restoring them first.
        </p>
      )}

      <FieldGroup title="Identity">
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
              <Label htmlFor="customer-name">Name</Label>
              <Input
                id="customer-name"
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
          name="companyName"
          validators={{
            onChange: ({ value }) =>
              value.trim().length > 160
                ? "Keep the company under 160 characters."
                : undefined,
          }}
        >
          {(field) => (
            <div className="flex flex-col gap-1">
              <Label htmlFor="customer-company">Company (optional)</Label>
              <Input
                id="customer-company"
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
      </FieldGroup>

      <FieldGroup title="Contact">
        <div className="grid grid-cols-2 gap-4">
          <form.Field
            name="email"
            validators={{
              onChange: ({ value }) => {
                const trimmed = value.trim();

                if (trimmed.length === 0) {
                  return "Enter an email address.";
                }

                if (trimmed.length > 320) {
                  return "Keep the email under 320 characters.";
                }

                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
                  return "Enter a valid email address.";
                }

                return undefined;
              },
            }}
          >
            {(field) => (
              <div className="flex flex-col gap-1">
                <Label htmlFor="customer-email">Email</Label>
                <Input
                  id="customer-email"
                  type="email"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  aria-invalid={field.state.meta.errors.length > 0 || undefined}
                  onChange={(event) => {
                    field.handleChange(event.target.value.toLowerCase());
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Stored lowercase. Must be unique across all customers.
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
            name="phone"
            validators={{
              onChange: ({ value }) =>
                value.trim().length > 40
                  ? "Keep the phone under 40 characters."
                  : undefined,
            }}
          >
            {(field) => (
              <div className="flex flex-col gap-1">
                <Label htmlFor="customer-phone">Phone (optional)</Label>
                <Input
                  id="customer-phone"
                  type="tel"
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
      </FieldGroup>

      <FieldGroup title="Address">
        <form.Field
          name="addressLine1"
          validators={{
            onChange: ({ value }) => {
              const trimmed = value.trim();

              if (trimmed.length === 0) {
                return "Enter an address line.";
              }

              if (trimmed.length > 160) {
                return "Keep the address under 160 characters.";
              }

              return undefined;
            },
          }}
        >
          {(field) => (
            <div className="flex flex-col gap-1">
              <Label htmlFor="customer-address-1">Address line 1</Label>
              <Input
                id="customer-address-1"
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
          name="addressLine2"
          validators={{
            onChange: ({ value }) =>
              value.trim().length > 160
                ? "Keep the address under 160 characters."
                : undefined,
          }}
        >
          {(field) => (
            <div className="flex flex-col gap-1">
              <Label htmlFor="customer-address-2">Address line 2</Label>
              <Input
                id="customer-address-2"
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

        <div className="grid grid-cols-2 gap-4">
          <form.Field
            name="city"
            validators={{
              onChange: ({ value }) => {
                const trimmed = value.trim();

                if (trimmed.length === 0) {
                  return "Enter a city.";
                }

                if (trimmed.length > 100) {
                  return "Keep the city under 100 characters.";
                }

                return undefined;
              },
            }}
          >
            {(field) => (
              <div className="flex flex-col gap-1">
                <Label htmlFor="customer-city">City</Label>
                <Input
                  id="customer-city"
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
            name="region"
            validators={{
              onChange: ({ value }) =>
                value.trim().length > 100
                  ? "Keep the region under 100 characters."
                  : undefined,
            }}
          >
            {(field) => (
              <div className="flex flex-col gap-1">
                <Label htmlFor="customer-region">
                  Region / state (optional)
                </Label>
                <Input
                  id="customer-region"
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

        <div className="grid grid-cols-2 gap-4">
          <form.Field
            name="postalCode"
            validators={{
              onChange: ({ value }) => {
                const trimmed = value.trim();

                if (trimmed.length === 0) {
                  return "Enter a postal code.";
                }

                if (trimmed.length > 24) {
                  return "Keep the postal code under 24 characters.";
                }

                return undefined;
              },
            }}
          >
            {(field) => (
              <div className="flex flex-col gap-1">
                <Label htmlFor="customer-postal">Postal code</Label>
                <Input
                  id="customer-postal"
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
            name="countryCode"
            validators={{
              onChange: ({ value }) =>
                value.trim().length !== 2
                  ? "Use a two-letter country code like US."
                  : undefined,
            }}
          >
            {(field) => (
              <div className="flex flex-col gap-1">
                <Label htmlFor="customer-country">Country code</Label>
                <Input
                  id="customer-country"
                  inputMode="text"
                  maxLength={2}
                  placeholder="US"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  aria-invalid={field.state.meta.errors.length > 0 || undefined}
                  onChange={(event) => {
                    field.handleChange(event.target.value.toUpperCase());
                  }}
                  className="uppercase"
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
      </FieldGroup>

      <FieldGroup title="Notes">
        <form.Field
          name="notes"
          validators={{
            onChange: ({ value }) =>
              value.trim().length > 2000
                ? "Keep the notes under 2000 characters."
                : undefined,
          }}
        >
          {(field) => (
            <div className="flex flex-col gap-1">
              <Label htmlFor="customer-notes">Notes (optional)</Label>
              <Textarea
                id="customer-notes"
                rows={3}
                value={field.state.value}
                onBlur={field.handleBlur}
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
      </FieldGroup>

      <div className="flex items-center gap-2">
        <SubmitButton pending={form.state.isSubmitting}>
          {mode === "create" ? "Create customer" : "Save changes"}
        </SubmitButton>
        <Button variant="ghost">
          <Link href="/customers">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
