import "server-only";

import { eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { roles, userRoles, users } from "@/db/schema";
import type { SignInData } from "@/features/auth/schemas";
import { AUDIT_ACTIONS } from "@/lib/audit/events";
import { writeAuditEvent } from "@/lib/audit/writer";
import { sanitizeRedirectPath } from "@/lib/auth/safe-redirect";
import { DomainError } from "@/lib/errors/action-result";
import { createClient } from "@/lib/supabase/server";

/**
 * Sign-in workflow.
 *
 * Password verification happens through Supabase Auth; application-level
 * admission (active account with at least one role) is enforced here. Any
 * rejection also clears the freshly established session so a forbidden user
 * never walks around with valid cookies. The last-signed-in stamp and the
 * `auth.signed_in` audit event commit in one transaction.
 */

const GENERIC_CREDENTIALS_MESSAGE =
  "Incorrect email or password. Please try again.";
const INACTIVE_MESSAGE =
  "This account has been disabled. Contact an administrator.";
const NO_ACCESS_MESSAGE =
  "This account has not been granted access yet. Contact an administrator to be assigned a role.";

export interface SignInResult {
  redirectTo: string;
}

export async function signInUser(
  data: SignInData,
  correlationId: string,
): Promise<SignInResult> {
  const supabase = await createClient();

  const { data: authData, error } = await supabase.auth.signInWithPassword({
    email: data.email,
    password: data.password,
  });

  // supabase-js types this field through success/failure overloads; treat
  // any non-null error uniformly as a credential rejection.
  if (Boolean(error) || authData.user === null) {
    throw new DomainError("UNAUTHENTICATED", GENERIC_CREDENTIALS_MESSAGE);
  }

  const userId = authData.user.id;

  try {
    const result = await getDb().transaction(async (tx) => {
      const profileRows = await tx
        .select({ isActive: users.isActive })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const profile = profileRows[0];

      if (!profile) {
        throw new DomainError("FORBIDDEN", NO_ACCESS_MESSAGE);
      }

      if (!profile.isActive) {
        throw new DomainError("FORBIDDEN", INACTIVE_MESSAGE);
      }

      const membershipRows = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(eq(userRoles.userId, userId));

      const roleCount = membershipRows[0]?.count ?? 0;

      if (roleCount === 0) {
        throw new DomainError("FORBIDDEN", NO_ACCESS_MESSAGE);
      }

      await tx
        .update(users)
        .set({ lastSignedInAt: new Date() })
        .where(eq(users.id, userId));

      await writeAuditEvent(tx, {
        actorUserId: userId,
        action: AUDIT_ACTIONS.authSignedIn,
        entityType: "user",
        entityId: userId,
        metadata: {},
        correlationId,
      });

      return {
        redirectTo: sanitizeRedirectPath(data.next),
      };
    });

    return result;
  } catch (error) {
    // Clear any session Supabase may have established before we rejected it.
    await supabase.auth.signOut();

    throw error;
  }
}
