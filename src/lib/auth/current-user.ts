import "server-only";

import { asc, eq } from "drizzle-orm";
import { cache } from "react";

import { getDb } from "@/db";
import { roles, userRoles, users } from "@/db/schema";
import { ROLE_KEYS, type RoleKey } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

/**
 * Verified application-user context.
 *
 * Identity is validated against the Supabase Auth server (`getUser()` never
 * trusts cookie contents alone); profile state and role membership come from
 * Drizzle-managed application tables.
 */

export { ROLE_KEYS };
export type { RoleKey };

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  roles: RoleKey[];
}

export type CurrentUserStatus =
  "authenticated" | "unauthenticated" | "inactive" | "unprovisioned";

export type CurrentUserResult =
  | { status: "authenticated"; user: CurrentUser }
  | { status: "unauthenticated" }
  | { status: "inactive" }
  | { status: "unprovisioned"; authUserId: string };

async function loadCurrentUser(
  accessToken?: string,
): Promise<CurrentUserResult> {
  const supabase = await createClient();

  const {
    data: { user: authUser },
    error,
  } = await supabase.auth.getUser(accessToken);

  if (error !== null || authUser === null) {
    return { status: "unauthenticated" };
  }

  const db = getDb();

  const profileRows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, authUser.id))
    .limit(1);

  const profile = profileRows[0];

  if (!profile) {
    return { status: "unprovisioned", authUserId: authUser.id };
  }

  if (!profile.isActive) {
    return { status: "inactive" };
  }

  const roleRows = await db
    .selectDistinct({ key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, profile.id))
    .orderBy(asc(roles.key));

  return {
    status: "authenticated",
    user: {
      id: profile.id,
      email: profile.email,
      displayName: profile.displayName,
      roles: roleRows.map((row) => row.key),
    },
  };
}

/**
 * Request-scoped verified current user. React's `cache()` deduplicates all
 * calls within one Server Component render pass, so layouts, pages, and
 * widgets share a single verification round-trip.
 */
export const getCurrentUser = cache(loadCurrentUser);
