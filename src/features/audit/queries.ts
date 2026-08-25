import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";

import { getDb } from "@/db";
import { auditLog, users } from "@/db/schema";
import { redactAuditMetadata } from "@/lib/audit/events";

import { auditListQuerySchema } from "./schemas";

import type {
  AuditDetailRow,
  AuditListPage,
  AuditListQuery,
  AuditListQueryInput,
} from "./schemas";

/**
 * Admin-only audit trail reads.
 *
 * List rows carry identity/actor/timestamps but never metadata; details
 * are fetched per event for the sheet and re-sanitized on the way out so
 * a future writer regression cannot leak through the UI.
 */

function buildConditions(query: AuditListQuery): SQL | undefined {
  const conditions: SQL[] = [];

  if (query.actor !== undefined) {
    conditions.push(eq(auditLog.actorUserId, query.actor));
  }

  if (query.action !== undefined) {
    conditions.push(eq(auditLog.action, query.action));
  }

  if (query.entityType !== undefined) {
    conditions.push(eq(auditLog.entityType, query.entityType));
  }

  if (query.entityId !== undefined) {
    conditions.push(eq(auditLog.entityId, query.entityId));
  }

  if (query.dateFrom !== undefined) {
    conditions.push(gte(auditLog.createdAt, sql`${query.dateFrom}::date`));
  }

  if (query.dateTo !== undefined) {
    conditions.push(
      lte(auditLog.createdAt, sql`${query.dateTo}::date + interval '1 day'`),
    );
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

export async function listAuditEvents(
  rawQuery: AuditListQueryInput,
): Promise<AuditListPage> {
  const db = getDb();

  const query = auditListQuerySchema.parse(rawQuery);
  const where = buildConditions(query);

  const [countRows, rows] = await Promise.all([
    db.select({ value: count() }).from(auditLog).where(where),
    db
      .select({
        id: auditLog.id,
        createdAt: sql<string>`${auditLog.createdAt}`,
        actorName: users.displayName,
        actorEmail: users.email,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        correlationId: auditLog.correlationId,
      })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.actorUserId, users.id))
      .where(where)
      .orderBy(desc(auditLog.createdAt), asc(auditLog.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
  ]);

  const total = countRows[0]?.value ?? 0;

  return {
    rows: rows.map((row) => ({
      id: row.id,
      createdAt: new Date(row.createdAt).toISOString(),
      actorName: row.actorName,
      actorEmail: row.actorEmail,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      correlationId: row.correlationId,
      hasDetails: true,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(Math.ceil(total / query.pageSize), 1),
  };
}

export async function getAuditEventDetail(
  id: string,
): Promise<AuditDetailRow | null> {
  const db = getDb();

  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      createdAt: sql<string>`${auditLog.createdAt}`,
      metadata: auditLog.metadata,
    })
    .from(auditLog)
    .where(eq(auditLog.id, id))
    .limit(1);

  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    createdAt: new Date(row.createdAt).toISOString(),
    metadata: redactAuditMetadata(row.metadata),
  };
}
