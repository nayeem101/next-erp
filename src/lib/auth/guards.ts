import "server-only";

import {
  getCurrentUser,
  type CurrentUser,
  type RoleKey,
} from "@/lib/auth/current-user";
import { hasAnyRole } from "@/lib/auth/roles";
import {
  actionFailure,
  type ActionFailureResult,
} from "@/lib/errors/action-result";
import { newCorrelationId } from "@/lib/errors/logging";

/**
 * Action-boundary guards. Every Server Action and route handler starts with
 * `getActionContext()`/`requireUser()` and, where roles matter, a
 * `requireAnyRole()` check before touching data.
 */

export interface AuthenticatedContext {
  ok: true;
  user: CurrentUser;
  correlationId: string;
}

export type UserGuardResult =
  | { ok: true; user: CurrentUser; correlationId: string }
  | (ActionFailureResult & { ok: false });

const INACTIVE_MESSAGE =
  "This account has been disabled. Contact an administrator.";
const UNPROVISIONED_MESSAGE =
  "This account is not provisioned yet. Contact an administrator to be assigned a role.";
const UNAUTHENTICATED_MESSAGE = "Please sign in to continue.";

/**
 * Verifies the caller and returns their context with a fresh correlation ID.
 * React's request-scoped cache keeps this to one verification per render.
 * The verification touches request cookies first, which also licenses the
 * subsequent random-value generation under Cache Components.
 */
export async function requireUser(): Promise<UserGuardResult> {
  const result = await getCurrentUser();
  const correlationId = newCorrelationId();

  switch (result.status) {
    case "authenticated":
      return {
        ok: true,
        user: result.user,
        correlationId,
      };
    case "unauthenticated":
      return {
        ...actionFailure("UNAUTHENTICATED", UNAUTHENTICATED_MESSAGE, {
          correlationId,
        }),
        ok: false,
      };
    case "inactive":
      return {
        ...actionFailure("FORBIDDEN", INACTIVE_MESSAGE, { correlationId }),
        ok: false,
      };
    case "unprovisioned":
      return {
        ...actionFailure("FORBIDDEN", UNPROVISIONED_MESSAGE, {
          correlationId,
        }),
        ok: false,
      };
  }
}

export type RoleGuardResult =
  { ok: true; user: CurrentUser } | (ActionFailureResult & { ok: false });

/** Authorizes an already-verified user against a role requirement. */
export function requireAnyRole(
  user: CurrentUser,
  allowed: readonly RoleKey[],
): RoleGuardResult {
  if (hasAnyRole(user.roles, allowed)) {
    return { ok: true, user };
  }

  return {
    ...actionFailure("FORBIDDEN", "You do not have access to this action."),
    ok: false,
  };
}

/** Convenience wrapper: verify the caller then apply a role requirement. */
export async function getActionContext(
  allowed?: readonly RoleKey[],
): Promise<AuthenticatedContext | (ActionFailureResult & { ok: false })> {
  const guard = await requireUser();

  if (!guard.ok) {
    return guard;
  }

  if (!allowed) {
    return {
      ok: true,
      user: guard.user,
      correlationId: guard.correlationId,
    };
  }

  const roleGuard = requireAnyRole(guard.user, allowed);

  if (!roleGuard.ok) {
    return roleGuard;
  }

  return {
    ok: true,
    user: roleGuard.user,
    correlationId: guard.correlationId,
  };
}
