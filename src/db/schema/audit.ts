import { index, jsonb, pgTable, uuid, varchar } from "drizzle-orm/pg-core";

import { createdAtOnly } from "@/db/schema/shared";
import { users } from "@/db/schema/users";

export interface AuditMetadata {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
  context?: Record<string, unknown>;
}

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: varchar("action", { length: 80 }).notNull(),
    entityType: varchar("entity_type", { length: 80 }).notNull(),
    entityId: uuid("entity_id"),
    metadata: jsonb("metadata").$type<AuditMetadata>().default({}).notNull(),
    correlationId: uuid("correlation_id").notNull(),
    ...createdAtOnly,
  },
  (table) => [
    index("audit_log_created_at_idx").on(table.createdAt),
    index("audit_log_actor_created_at_idx").on(
      table.actorUserId,
      table.createdAt,
    ),
    index("audit_log_entity_idx").on(table.entityType, table.entityId),
    index("audit_log_action_idx").on(table.action),
  ],
);
