"use server";

import {
  actionSuccess,
  type ActionResult,
  validationFailure,
} from "@/lib/errors/action-result";
import { newCorrelationId, logWarn } from "@/lib/errors/logging";
import { mapActionError } from "@/lib/errors/map-action-error";
import { createClient } from "@/lib/supabase/server";

import { signInSchema, type SignInInput } from "./schemas";
import { signInUser } from "./service";

/**
 * Password sign-in. Public by design: unauthenticated callers are the
 * audience. Returns the sanitized redirect target; the client navigates.
 */
export async function signIn(
  input: SignInInput,
): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = signInSchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  try {
    const result = await signInUser(parsed.data, newCorrelationId());

    return actionSuccess(result);
  } catch (error) {
    return mapActionError(error, newCorrelationId());
  }
}

/**
 * Session teardown. Per the API contract a missing session still counts as
 * a successful logout; any other failure is logged and surfaced generically.
 */
export async function signOut(): Promise<
  ActionResult<{ redirectTo: "/login" }>
> {
  const correlationId = newCorrelationId();

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();

    if (error !== null && error.status !== 400 && error.status !== 401) {
      logWarn(
        { operation: "auth.signOut", correlationId },
        "Supabase reported an error during sign-out; treating as success.",
      );
    }

    return actionSuccess({ redirectTo: "/login" });
  } catch (caughtError: unknown) {
    return mapActionError(caughtError, correlationId);
  }
}
