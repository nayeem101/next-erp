import { z } from "zod";

import { AUDIT_ACTION_VALUES, AUDIT_ENTITY_TYPES } from "@/lib/audit/events";

/** Audit log list query contract. Admin-only upstream. */
export const auditListQuerySchema = z.object({
  /** Exact actor user id. */
  actor: z.uuid().optional(),
  action: z.enum(AUDIT_ACTION_VALUES as [string, ...string[]]).optional(),
  entityType: z.enum(AUDIT_ENTITY_TYPES).optional(),
  entityId: z.uuid().optional(),
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export type AuditListQuery = z.infer<typeof auditListQuerySchema>;
export type AuditListQueryInput = z.input<typeof auditListQuerySchema>;

export interface AuditListRow {
  id: string;
  createdAt: string;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  correlationId: string;
  hasDetails: boolean;
}

/**
 * Detail-sheet payload: only the already-sanitized metadata recorded at
 * write time, re-passed through redaction for defense in depth.
 */
export interface AuditDetailRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface AuditListPage {
  rows: AuditListRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
