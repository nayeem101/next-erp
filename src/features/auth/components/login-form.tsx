"use client";

import { useForm } from "@tanstack/react-form";
import { useSelector } from "@tanstack/react-store";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { ActionErrorAlert } from "@/components/shared/action-error-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/features/auth/actions";
import { signInSchema, type SignInInput } from "@/features/auth/schemas";
import type { ActionError } from "@/lib/errors/action-result";

interface LoginFormProps {
  initialNext: string;
}

/**
 * The wire contract treats `next` as fully optional; the form always carries
 * the key and normalizes blank to absent. Extending the canonical schema
 * keeps every shared rule single-sourced while matching that shape.
 */
const loginFormSchema = signInSchema.extend({
  next: z
    .string()
    .max(2048)
    .transform((value) => {
      const trimmed = value.trim();
      return trimmed === "" ? undefined : trimmed;
    }),
});

type SignInFormValues = z.input<typeof loginFormSchema>;

function focusFirstInvalidField(
  meta: Record<string, { isValid: boolean } | undefined>,
): void {
  const firstInvalid = Object.entries(meta).find(
    ([, value]) => value?.isValid === false,
  )?.[0];

  if (firstInvalid) {
    document.getElementById(firstInvalid)?.focus();
  }
}

export function LoginForm({ initialNext }: LoginFormProps) {
  const [submissionError, setSubmissionError] = useState<ActionError>();
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
      next: initialNext,
    } satisfies SignInFormValues,
    validators: {
      onSubmit: loginFormSchema,
    },
    onSubmit: async ({ value }) => {
      setSubmissionError(undefined);

      const payload: SignInInput = {
        email: value.email,
        password: value.password,
        next: value.next,
      };

      setIsPending(true);

      try {
        const result = await signIn(payload);

        if (result.ok) {
          // Full navigation so fresh session cookies apply to every asset.
          window.location.assign(result.data.redirectTo);
          return;
        }

        setSubmissionError(result.error);
      } finally {
        setIsPending(false);
      }
    },
  });

  // TanStack treats validation as part of "submitting"; disabling fields
  // during that window would break focusing the first invalid field.
  const [isPending, setIsPending] = useState(false);
  const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();

        void form
          .handleSubmit()
          .catch(() => undefined)
          .then(() => {
            // Validation is asynchronous; focus once errors are committed.
            if (!form.state.isValid) {
              focusFirstInvalidField(form.state.fieldMeta);
            }
          });
      }}
    >
      <form.Field name="email">
        {(field) => {
          const fieldErrors = field.state.meta.errors;

          return (
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                disabled={isPending}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                }}
                aria-invalid={fieldErrors.length > 0}
                aria-describedby={
                  fieldErrors.length > 0 ? "email-error" : undefined
                }
              />
              {fieldErrors.length > 0 && (
                <p id="email-error" className="text-sm text-destructive">
                  {fieldErrors[0]?.message ?? "Enter a valid email."}
                </p>
              )}
            </div>
          );
        }}
      </form.Field>

      <form.Field name="password">
        {(field) => {
          const fieldErrors = field.state.meta.errors;

          return (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <button
                  type="button"
                  onClick={() => {
                    setShowPassword((visible) => !visible);
                  }}
                  aria-pressed={showPassword}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="inline-flex items-center gap-1 rounded text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {showPassword ? (
                    <EyeOff aria-hidden="true" className="size-3.5" />
                  ) : (
                    <Eye aria-hidden="true" className="size-3.5" />
                  )}
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                disabled={isPending}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                }}
                aria-invalid={fieldErrors.length > 0}
                aria-describedby={
                  fieldErrors.length > 0 ? "password-error" : undefined
                }
              />
              {fieldErrors.length > 0 && (
                <p id="password-error" className="text-sm text-destructive">
                  {fieldErrors[0]?.message ?? "Enter your password."}
                </p>
              )}
            </div>
          );
        }}
      </form.Field>

      {submissionError ? <ActionErrorAlert error={submissionError} /> : null}

      <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit })}>
        {({ canSubmit }) => (
          <Button
            type="submit"
            className="w-full"
            disabled={!canSubmit || isSubmitting || isPending}
          >
            {isSubmitting || isPending ? "Signing in…" : "Sign in"}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
