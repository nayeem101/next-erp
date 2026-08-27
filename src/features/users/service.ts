import "server-only";

import { and, eq, inArray, ne, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { roles, userRoles, users } from "@/db/schema";
import { AUDIT_ACTIONS } from "@/lib/audit/events";
import { writeAuditEvent } from "@/lib/audit/writer";
import { ROLE_KEYS, type RoleKey } from "@/lib/auth/roles";
import { DomainError } from "@/lib/errors/action-result";

import type {
  SetUserActiveInput,
  SetUserActiveResult,
  SetUserRolesInput,
  SetUserRolesResult,
} from "./schemas";

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
      const missingRoles = after.filter((key) => !idByKey.has(key));

      if (missingRoles.length > 0) {
        throw new DomainError(
          "INTERNAL_ERROR",
          "Role configuration is incomplete. Run pnpm db:seed and try again.",
          { details: { missingRoles } },
        );
      }

      await tx.insert(userRoles).values(
        after.map((key) => {
          const roleId = idByKey.get(key);

          // The missing-role check above guarantees this branch is not
          // reached, while keeping the insert payload type-safe.
          if (roleId === undefined) {
            throw new DomainError(
              "INTERNAL_ERROR",
              "Role configuration is incomplete. Run pnpm db:seed and try again.",
              { details: { missingRoles: [key] } },
            );
          }

          return {
            userId: input.userId,
            roleId,
            assignedBy: actorUserId,
          };
        }),
      );
    }

    await writeAuditEvent(tx, {
      actorUserId,
      action: AUDIT_ACTIONS.userRolesChanged,
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

/**
 * Enable/disable workflow.
 *
 * Shares the role-administration advisory lock because an admin's active
 * flag participates in the last-active-Admin invariant.
 */
export async function setUserActive(
  input: SetUserActiveInput,
  actorUserId: string,
  correlationId: string,
): Promise<SetUserActiveResult> {
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${ROLE_ADMINISTRATION_LOCK})`,
    );

    const targetRows = await tx
      .select({ id: users.id, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);

    const target = targetRows[0];

    if (!target) {
      throw new DomainError("NOT_FOUND", "That user no longer exists.");
    }

    if (!input.isActive) {
      // The caller is always an Admin (action guard), so self-disable is a
      // special case of removing an active administrator and is covered by
      // the same survivor count below.
      const membershipRows = await tx
        .select({ key: roles.key })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(eq(userRoles.userId, input.userId));

      const isAdmin = membershipRows.some((row) => row.key === "admin");

      if (isAdmin) {
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
    }

    await tx
      .update(users)
      .set({ isActive: input.isActive })
      .where(eq(users.id, input.userId));

    await writeAuditEvent(tx, {
      actorUserId,
      action: input.isActive
        ? AUDIT_ACTIONS.userEnabled
        : AUDIT_ACTIONS.userDisabled,
      entityType: "user",
      entityId: input.userId,
      metadata: {
        before: { isActive: target.isActive },
        after: { isActive: input.isActive },
      },
      correlationId,
    });

    return { userId: input.userId, isActive: input.isActive };
  });
}
