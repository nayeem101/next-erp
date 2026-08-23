import "server-only";

import type { Database } from "@/db";
import { auditLog, type AuditMetadata } from "@/db/schema";

/**
 * Appends an audit event using the caller's transaction so the record lands
 * atomically with the mutation it describes. Never pass credentials or raw
 * payloads as metadata.
 */

export interface AuditEventInput {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: AuditMetadata;
  correlationId: string;
}

export async function writeAuditEvent(
  db: Database,
  event: AuditEventInput,
): Promise<void> {
  await db.insert(auditLog).values({
    actorUserId: event.actorUserId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId ?? null,
    metadata: event.metadata ?? {},
    correlationId: event.correlationId,
  });
}
