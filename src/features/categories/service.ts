import "server-only";

import { eq, ilike, or, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { categories } from "@/db/schema";
import { slugify } from "@/features/categories/schemas";
import { writeAuditEvent } from "@/lib/audit/writer";
import { DomainError } from "@/lib/errors/action-result";

import type { CreateCategoryInput, CreateCategoryResult } from "./schemas";

/**
 * Category creation workflow.
 *
 * Uniqueness is checked up front (case-normalized name, derived slug) so
 * callers get a precise conflict message; the database constraints remain
 * the final arbiter under concurrent writes.
 */

const NAME_CONFLICT_MESSAGE =
  "A category with this name already exists. Choose a different name.";
const SLUG_CONFLICT_MESSAGE =
  "This name resolves to a URL slug that is already taken. Choose a different name.";

export async function createCategory(
  input: CreateCategoryInput,
  actorUserId: string,
  correlationId: string,
): Promise<CreateCategoryResult> {
  const db = getDb();
  const slug = slugify(input.name);

  const conflicts = await db
    .select({ name: categories.name })
    .from(categories)
    .where(
      or(
        sql`lower(${categories.name}) = lower(${input.name})`,
        eq(categories.slug, slug),
        ilike(categories.name, input.name),
      ),
    )
    .limit(1);

  if (conflicts.length > 0) {
    throw new DomainError("UNIQUE_CONFLICT", NAME_CONFLICT_MESSAGE);
  }

  try {
    return await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(categories)
        .values({
          name: input.name,
          slug,
          description: input.description ?? null,
          createdBy: actorUserId,
          updatedBy: actorUserId,
        })
        .returning({ id: categories.id });

      const categoryId = inserted[0]?.id;

      if (!categoryId) {
        throw new DomainError(
          "INTERNAL_ERROR",
          "Category could not be created.",
        );
      }

      await writeAuditEvent(tx, {
        actorUserId,
        action: "category.created",
        entityType: "category",
        entityId: categoryId,
        metadata: {
          after: { name: input.name, slug },
        },
        correlationId,
      });

      return { categoryId, slug };
    });
  } catch (error) {
    // Concurrent writers lose the race at the constraint; present the same
    // precise message as the up-front check.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "23505"
    ) {
      throw new DomainError("UNIQUE_CONFLICT", SLUG_CONFLICT_MESSAGE);
    }

    throw error;
  }
}
