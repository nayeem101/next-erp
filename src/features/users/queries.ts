import "server-only";

import {
  and,
  count,
  eq,
  exists,
  ilike,
  inArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { getDb } from "@/db";
import { roles, userRoles, users } from "@/db/schema";
import { ROLE_KEYS, type RoleKey } from "@/lib/auth/roles";
import { ilikeContainsPattern } from "@/lib/list-query/escape";

import type { UserListPage, UserListQuery, UserListRow } from "./schemas";

/**
 * Admin user-list query.
 *
 * Two round-trips: one paginated profile page ordered by case-insensitive
 * email (matching the `users_email_lower_unique` index), then the role
 * memberships for exactly those rows, grouped in memory.
 */

function buildConditions(query: UserListQuery): SQL | undefined {
  const conditions: SQL[] = [];

  if (query.search !== undefined) {
    const pattern = ilikeContainsPattern(query.search);

    const textMatch = or(
      ilike(users.email, pattern),
      ilike(users.displayName, pattern),
    );

    if (textMatch) {
      conditions.push(textMatch);
    }
  }

  if (query.role !== undefined) {
    const membership = getDb()
      .select({ one: sql`1` })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, users.id), eq(roles.key, query.role)));

    conditions.push(exists(membership));
  }

  if (query.status !== undefined) {
    conditions.push(eq(users.isActive, query.status === "active"));
  }

  if (conditions.length === 0) {
    return undefined;
  }

  return and(...conditions);
}

export async function listUsers(query: UserListQuery): Promise<UserListPage> {
  const db = getDb();
  const where = buildConditions(query);

  const [countRows, profileRows] = await Promise.all([
    db.select({ value: count() }).from(users).where(where),
    db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        isActive: users.isActive,
        lastSignedInAt: users.lastSignedInAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(where)
      .orderBy(sql`lower(${users.email})`)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
  ]);

  const total = countRows[0]?.value ?? 0;

  const memberships =
    profileRows.length > 0
      ? await db
          .select({ userId: userRoles.userId, key: roles.key })
          .from(userRoles)
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(
            inArray(
              userRoles.userId,
              profileRows.map((row) => row.id),
            ),
          )
      : [];

  const rolesByUser = new Map<string, RoleKey[]>();

  // Deterministic presentation order regardless of join order.
  const roleOrder = new Map<RoleKey, number>(
    ROLE_KEYS.map((key, index) => [key, index]),
  );

  for (const membership of memberships) {
    const assigned = rolesByUser.get(membership.userId) ?? [];
    assigned.push(membership.key);
    rolesByUser.set(membership.userId, assigned);
  }

  for (const assigned of rolesByUser.values()) {
    assigned.sort(
      (left, right) => (roleOrder.get(left) ?? 0) - (roleOrder.get(right) ?? 0),
    );
  }

  const rows: UserListRow[] = profileRows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    isActive: row.isActive,
    lastSignedInAt: row.lastSignedInAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    roles: rolesByUser.get(row.id) ?? [],
  }));

  return {
    rows,
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}
