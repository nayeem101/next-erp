import "server-only";

import type { Database } from "@/db";
import { auditLog } from "@/db/schema";
import type { AuditMetadata } from "@/db/schema";
import { redactAuditMetadata } from "@/lib/audit/events";

/**
 * Appends an audit event using the caller's transaction so the record lands
 * atomically with the mutation it describes. Metadata passes through
 * redaction (credential-shaped keys stripped, oversized values capped) as a
 * defense-in-depth backstop for writers.
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
    metadata: redactAuditMetadata(event.metadata ?? {}) as AuditMetadata,
    correlationId: event.correlationId,
  });
}
