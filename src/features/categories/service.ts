import "server-only";

import { and, eq, ilike, ne, or, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { categories } from "@/db/schema";
import { slugify } from "@/features/categories/schemas";
import { writeAuditEvent } from "@/lib/audit/writer";
import { DomainError } from "@/lib/errors/action-result";

import type {
  CreateCategoryInput,
  CreateCategoryResult,
  UpdateCategoryInput,
  UpdateCategoryResult,
} from "./schemas";

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

/**
 * Category rename/redescription workflow.
 *
 * The audit event carries only the fields that actually changed so the log
 * reads as a diff, not a snapshot echo.
 */
export async function updateCategory(
  input: UpdateCategoryInput,
  actorUserId: string,
  correlationId: string,
): Promise<UpdateCategoryResult> {
  const db = getDb();
  const nextSlug = slugify(input.name);

  const existingRows = await db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      description: categories.description,
    })
    .from(categories)
    .where(eq(categories.id, input.categoryId))
    .limit(1);

  const existing = existingRows[0];

  if (!existing) {
    throw new DomainError("NOT_FOUND", "That category no longer exists.");
  }

  const nameChanged = existing.name !== input.name;
  const descriptionChanged =
    (existing.description ?? undefined) !== input.description;
  const slugChanged = existing.slug !== nextSlug;

  if (nameChanged || slugChanged) {
    const conflicts = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          ne(categories.id, input.categoryId),
          or(
            sql`lower(${categories.name}) = lower(${input.name})`,
            eq(categories.slug, nextSlug),
          ),
        ),
      )
      .limit(1);

    if (conflicts.length > 0) {
      throw new DomainError(
        "UNIQUE_CONFLICT",
        NAME_CONFLICT_MESSAGE.replace(
          "already exists. Choose a different name.",
          "is already taken by another category.",
        ),
      );
    }
  }

  try {
    return await db.transaction(async (tx) => {
      await tx
        .update(categories)
        .set({
          ...(nameChanged ? { name: input.name } : {}),
          ...(slugChanged ? { slug: nextSlug } : {}),
          ...(descriptionChanged
            ? { description: input.description ?? null }
            : {}),
          updatedBy: actorUserId,
        })
        .where(eq(categories.id, input.categoryId));

      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};

      if (nameChanged) {
        before.name = existing.name;
        after.name = input.name;
      }
      if (slugChanged) {
        before.slug = existing.slug;
        after.slug = nextSlug;
      }
      if (descriptionChanged) {
        before.description = existing.description ?? null;
        after.description = input.description ?? null;
      }

      await writeAuditEvent(tx, {
        actorUserId,
        action: "category.updated",
        entityType: "category",
        entityId: input.categoryId,
        metadata: { before, after },
        correlationId,
      });

      return { categoryId: input.categoryId };
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "23505"
    ) {
      throw new DomainError(
        "UNIQUE_CONFLICT",
        "Another category already uses this name or slug.",
      );
    }

    throw error;
  }
}
