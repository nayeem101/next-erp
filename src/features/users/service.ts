import "server-only";

import { and, eq, inArray, ne, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { roles, userRoles, users } from "@/db/schema";
import { writeAuditEvent } from "@/lib/audit/writer";
import { ROLE_KEYS, type RoleKey } from "@/lib/auth/roles";
import { DomainError } from "@/lib/errors/action-result";

import type { SetUserRolesInput, SetUserRolesResult } from "./schemas";

/**
 * Role administration workflow.
 *
 * Every mutation takes a transaction-scoped advisory lock so concurrent
 * role changes serialize before they read membership state; last-active-
 * Admin protection then evaluates against locked, current data.
 */

export const ROLE_ADMINISTRATION_LOCK = 7_482_365_120;

const LAST_ADMIN_MESSAGE =
  "This change would leave the workspace without an active administrator. Grant another user the Admin role first.";

function canonicalRoleOrder(keys: readonly RoleKey[]): RoleKey[] {
  return [...keys].sort(
    (left, right) => ROLE_KEYS.indexOf(left) - ROLE_KEYS.indexOf(right),
  );
}

export async function setUserRoles(
  input: SetUserRolesInput,
  actorUserId: string,
  correlationId: string,
): Promise<SetUserRolesResult> {
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${ROLE_ADMINISTRATION_LOCK})`,
    );

    const targetRows = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);

    if (targetRows.length === 0) {
      throw new DomainError("NOT_FOUND", "That user no longer exists.");
    }

    const membershipRows = await tx
      .select({ key: roles.key })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, input.userId));

    const before = canonicalRoleOrder(membershipRows.map((row) => row.key));
    const after = canonicalRoleOrder(input.roles);

    if (before.includes("admin") && !after.includes("admin")) {
      const otherAdmins = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .innerJoin(users, eq(users.id, userRoles.userId))
        .where(
          and(
            eq(roles.key, "admin"),
            ne(userRoles.userId, input.userId),
            eq(users.isActive, true),
          ),
        );

      if ((otherAdmins[0]?.count ?? 0) === 0) {
        throw new DomainError("LAST_ADMIN", LAST_ADMIN_MESSAGE);
      }
    }

    await tx.delete(userRoles).where(eq(userRoles.userId, input.userId));

    if (after.length > 0) {
      const roleRows = await tx
        .select({ id: roles.id, key: roles.key })
        .from(roles)
        .where(inArray(roles.key, after));

      const idByKey = new Map(roleRows.map((row) => [row.key, row.id]));

      await tx.insert(userRoles).values(
        after.map((key) => ({
          userId: input.userId,
          roleId: idByKey.get(key) ?? "",
          assignedBy: actorUserId,
        })),
      );
    }

    await writeAuditEvent(tx, {
      actorUserId,
      action: "user.roles_changed",
      entityType: "user",
      entityId: input.userId,
      metadata: {
        before: { roles: before },
        after: { roles: after },
      },
      correlationId,
    });

    return { userId: input.userId, roles: after };
  });
}
