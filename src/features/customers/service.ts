import "server-only";

import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { customers } from "@/db/schema";
import { writeAuditEvent } from "@/lib/audit/writer";
import { DomainError } from "@/lib/errors/action-result";

import type {
  CreateCustomerInput,
  CreateCustomerResult,
  SetCustomerActiveInput,
  SetCustomerActiveResult,
  UpdateCustomerInput,
  UpdateCustomerResult,
} from "./schemas";

/**
 * Customer workflows.
 *
 * Email uniqueness is enforced case-insensitively by the
 * `customers_email_lower_unique` index.  A pre-check gives callers a
 * precise conflict message; the index remains the final arbiter under
 * concurrent writes (drizzle wraps driver errors, so the cause chain is
 * inspected for the 23505 code).
 */

const EMAIL_CONFLICT_MESSAGE =
  "A customer with this email already exists. Emails are case-insensitive.";

const NOT_FOUND_MESSAGE = "That customer no longer exists.";

export async function createCustomer(
  input: CreateCustomerInput,
  actorUserId: string,
  correlationId: string,
): Promise<CreateCustomerResult> {
  const db = getDb();

  const emailConflict = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.email, input.email))
    .limit(1);

  if (emailConflict.length > 0) {
    throw new DomainError("UNIQUE_CONFLICT", EMAIL_CONFLICT_MESSAGE);
  }

  try {
    return await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(customers)
        .values({
          name: input.name,
          email: input.email,
          phone: input.phone ?? null,
          companyName: input.companyName ?? null,
          addressLine1: input.addressLine1,
          addressLine2: input.addressLine2 ?? null,
          city: input.city,
          region: input.region ?? null,
          postalCode: input.postalCode,
          countryCode: input.countryCode,
          notes: input.notes ?? null,
          isActive: true,
          createdBy: actorUserId,
          updatedBy: actorUserId,
        })
        .returning({ id: customers.id });

      const row = inserted[0];

      if (!row) {
        throw new DomainError(
          "INTERNAL_ERROR",
          "Customer could not be created.",
        );
      }

      await writeAuditEvent(tx, {
        actorUserId,
        action: "customer.created",
        entityType: "customer",
        entityId: row.id,
        metadata: {
          after: {
            name: input.name,
            email: input.email,
            companyName: input.companyName ?? null,
            city: input.city,
            countryCode: input.countryCode,
          },
        },
        correlationId,
      });

      return { customerId: row.id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DomainError("UNIQUE_CONFLICT", EMAIL_CONFLICT_MESSAGE);
    }

    throw error;
  }
}

/**
 * Full-field customer update with changed-field audit metadata.  The audit
 * event carries only the fields that actually changed.
 */
export async function updateCustomer(
  input: UpdateCustomerInput,
  actorUserId: string,
  correlationId: string,
): Promise<UpdateCustomerResult> {
  const db = getDb();

  const existingRows = await db
    .select()
    .from(customers)
    .where(eq(customers.id, input.customerId))
    .limit(1);

  const existing = existingRows[0];

  if (!existing) {
    throw new DomainError("NOT_FOUND", NOT_FOUND_MESSAGE);
  }

  if (input.email !== existing.email) {
    const emailConflict = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.email, input.email))
      .limit(1);

    if (emailConflict.length > 0) {
      throw new DomainError("UNIQUE_CONFLICT", EMAIL_CONFLICT_MESSAGE);
    }
  }

  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  function track(field: string, prev: unknown, next: unknown): void {
    if (prev !== next) {
      before[field] = prev;
      after[field] = next;
    }
  }

  track("name", existing.name, input.name);
  track("email", existing.email, input.email);
  track("phone", existing.phone, input.phone ?? null);
  track("companyName", existing.companyName, input.companyName ?? null);
  track("addressLine1", existing.addressLine1, input.addressLine1);
  track("addressLine2", existing.addressLine2, input.addressLine2 ?? null);
  track("city", existing.city, input.city);
  track("region", existing.region, input.region ?? null);
  track("postalCode", existing.postalCode, input.postalCode);
  track("countryCode", existing.countryCode, input.countryCode);
  track("notes", existing.notes, input.notes ?? null);

  if (Object.keys(before).length === 0) {
    return { customerId: existing.id };
  }

  try {
    return await db.transaction(async (tx) => {
      await tx
        .update(customers)
        .set({
          name: input.name,
          email: input.email,
          phone: input.phone ?? null,
          companyName: input.companyName ?? null,
          addressLine1: input.addressLine1,
          addressLine2: input.addressLine2 ?? null,
          city: input.city,
          region: input.region ?? null,
          postalCode: input.postalCode,
          countryCode: input.countryCode,
          notes: input.notes ?? null,
          updatedBy: actorUserId,
        })
        .where(eq(customers.id, input.customerId));

      await writeAuditEvent(tx, {
        actorUserId,
        action: "customer.updated",
        entityType: "customer",
        entityId: existing.id,
        metadata: { before, after },
        correlationId,
      });

      return { customerId: existing.id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DomainError("UNIQUE_CONFLICT", EMAIL_CONFLICT_MESSAGE);
    }

    throw error;
  }
}

/**
 * Archive/restore toggle.  Historical orders keep their relationship and
 * remain viewable; order authoring gates on active customers elsewhere.
 */
export async function setCustomerActive(
  input: SetCustomerActiveInput,
  actorUserId: string,
  correlationId: string,
): Promise<SetCustomerActiveResult> {
  const db = getDb();

  const targetRows = await db
    .select({ id: customers.id, isActive: customers.isActive })
    .from(customers)
    .where(eq(customers.id, input.customerId))
    .limit(1);

  const target = targetRows[0];

  if (!target) {
    throw new DomainError("NOT_FOUND", NOT_FOUND_MESSAGE);
  }

  if (target.isActive === input.isActive) {
    return { customerId: target.id, isActive: input.isActive };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(customers)
      .set({ isActive: input.isActive, updatedBy: actorUserId })
      .where(eq(customers.id, input.customerId));

    await writeAuditEvent(tx, {
      actorUserId,
      action: input.isActive ? "customer.restored" : "customer.archived",
      entityType: "customer",
      entityId: input.customerId,
      metadata: {
        before: { isActive: target.isActive },
        after: { isActive: input.isActive },
      },
      correlationId,
    });
  });

  return { customerId: input.customerId, isActive: input.isActive };
}

/**
 * Drizzle rethrows driver errors wrapped as generic failures with the
 * original PostgresError on `cause`, so walk the chain for 23505.
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;

  for (
    let depth = 0;
    typeof current === "object" && current !== null && depth < 5;
    depth += 1
  ) {
    const candidate = current as { code?: unknown; cause?: unknown };

    if (candidate.code === "23505") {
      return true;
    }

    current = candidate.cause;
  }

  return false;
}
