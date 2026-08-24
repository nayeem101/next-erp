import "server-only";

import { and, eq, gte, lte, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { categories, products, stockMovements } from "@/db/schema";
import { writeAuditEvent } from "@/lib/audit/writer";
import { DomainError } from "@/lib/errors/action-result";
import { parseMoneyToCents } from "@/lib/money";

import type {
  AdjustStockInput,
  AdjustStockResult,
  CreateProductInput,
  CreateProductResult,
  SetProductActiveInput,
  SetProductActiveResult,
  UpdateProductInput,
  UpdateProductResult,
} from "./schemas";

/**
 * Product workflows.
 *
 * SKU uniqueness is checked up front so callers get a precise conflict
 * message; the upper() unique index remains the final arbiter under
 * concurrent writes.  Stock changes always land in `stock_movements` in the
 * same transaction as the `stock_on_hand` update, and the balance update is
 * a single atomic SQL statement so concurrent adjustments cannot lose writes.
 */

const SKU_CONFLICT_MESSAGE =
  "A product with this SKU already exists. SKUs are case-insensitive.";

const NOT_FOUND_MESSAGE = "That product no longer exists.";

export async function createProduct(
  input: CreateProductInput,
  actorUserId: string,
  correlationId: string,
): Promise<CreateProductResult> {
  const db = getDb();

  const categoryRows = await db
    .select({ id: categories.id, isActive: categories.isActive })
    .from(categories)
    .where(eq(categories.id, input.categoryId))
    .limit(1);

  const category = categoryRows[0];

  if (!category) {
    throw new DomainError("NOT_FOUND", "That category no longer exists.");
  }

  if (!category.isActive) {
    throw new DomainError(
      "CONFLICT",
      "Products can only be created in active categories.",
    );
  }

  const skuConflict = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.sku, input.sku))
    .limit(1);

  if (skuConflict.length > 0) {
    throw new DomainError("UNIQUE_CONFLICT", SKU_CONFLICT_MESSAGE);
  }

  try {
    return await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(products)
        .values({
          categoryId: input.categoryId,
          sku: input.sku,
          name: input.name,
          description: input.description ?? null,
          unitPriceCents: parseMoneyToCents(input.unitPrice) ?? 0n,
          stockOnHand: input.openingStock,
          reorderLevel: input.reorderLevel,
          isActive: true,
          createdBy: actorUserId,
          updatedBy: actorUserId,
        })
        .returning({ id: products.id });

      const productRow = inserted[0];

      if (!productRow) {
        throw new DomainError(
          "INTERNAL_ERROR",
          "Product could not be created.",
        );
      }

      const productId = productRow.id;

      if (input.openingStock > 0) {
        await tx.insert(stockMovements).values({
          productId,
          type: "opening",
          quantityDelta: input.openingStock,
          resultingStock: input.openingStock,
          reason: "Opening balance",
          createdBy: actorUserId,
        });
      }

      await writeAuditEvent(tx, {
        actorUserId,
        action: "product.created",
        entityType: "product",
        entityId: productId,
        metadata: {
          after: {
            sku: input.sku,
            name: input.name,
            unitPriceCents: parseMoneyToCents(input.unitPrice)?.toString(),
            stockOnHand: input.openingStock,
            reorderLevel: input.reorderLevel,
          },
        },
        correlationId,
      });

      return { productId };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DomainError("UNIQUE_CONFLICT", SKU_CONFLICT_MESSAGE);
    }

    throw error;
  }
}

/**
 * Full-field product update with changed-field audit metadata.  The audit
 * event carries only the fields that actually changed so the log reads as a
 * diff, not a snapshot echo.
 */
export async function updateProduct(
  input: UpdateProductInput,
  actorUserId: string,
  correlationId: string,
): Promise<UpdateProductResult> {
  const db = getDb();

  const existingRows = await db
    .select()
    .from(products)
    .where(eq(products.id, input.productId))
    .limit(1);

  const existing = existingRows[0];

  if (!existing) {
    throw new DomainError("NOT_FOUND", NOT_FOUND_MESSAGE);
  }

  const categoryRows = await db
    .select({ id: categories.id, isActive: categories.isActive })
    .from(categories)
    .where(eq(categories.id, input.categoryId))
    .limit(1);

  if (!categoryRows[0]) {
    throw new DomainError("NOT_FOUND", "That category no longer exists.");
  }

  if (!categoryRows[0].isActive) {
    throw new DomainError(
      "CONFLICT",
      "Products cannot be moved into an inactive category.",
    );
  }

  const nextUnitPriceCents = parseMoneyToCents(input.unitPrice) ?? 0n;
  const nextDescription = input.description ?? null;

  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  function track(field: string, prev: unknown, next: unknown): void {
    if (prev !== next) {
      before[field] = prev;
      after[field] = next;
    }
  }

  track("categoryId", existing.categoryId, input.categoryId);
  track("sku", existing.sku, input.sku);
  track("name", existing.name, input.name);
  track("description", existing.description, nextDescription);
  track(
    "unitPriceCents",
    existing.unitPriceCents.toString(),
    nextUnitPriceCents.toString(),
  );
  track("reorderLevel", existing.reorderLevel, input.reorderLevel);

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(products)
        .set({
          categoryId: input.categoryId,
          sku: input.sku,
          name: input.name,
          description: nextDescription,
          unitPriceCents: nextUnitPriceCents,
          reorderLevel: input.reorderLevel,
          updatedBy: actorUserId,
        })
        .where(eq(products.id, input.productId));

      if (Object.keys(before).length > 0) {
        await writeAuditEvent(tx, {
          actorUserId,
          action: "product.updated",
          entityType: "product",
          entityId: input.productId,
          metadata: { before, after },
          correlationId,
        });
      }
    });

    return { productId: input.productId };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DomainError("UNIQUE_CONFLICT", SKU_CONFLICT_MESSAGE);
    }

    throw error;
  }
}

/**
 * Archive/restore workflow.  Toggling to the current state is a no-op that
 * still reports success so idempotent retries stay green.
 */
export async function setProductActive(
  input: SetProductActiveInput,
  actorUserId: string,
  correlationId: string,
): Promise<SetProductActiveResult> {
  const db = getDb();

  const targetRows = await db
    .select({
      id: products.id,
      isActive: products.isActive,
      categoryId: products.categoryId,
    })
    .from(products)
    .where(eq(products.id, input.productId))
    .limit(1);

  const target = targetRows[0];

  if (!target) {
    throw new DomainError("NOT_FOUND", NOT_FOUND_MESSAGE);
  }

  if (input.isActive && !target.isActive) {
    const categoryRows = await db
      .select({ isActive: categories.isActive })
      .from(categories)
      .where(eq(categories.id, target.categoryId))
      .limit(1);

    const category = categoryRows[0];

    if (!category?.isActive) {
      throw new DomainError(
        "CONFLICT",
        "Restore the product's category before restoring the product.",
      );
    }
  }

  if (target.isActive === input.isActive) {
    return { productId: input.productId, isActive: input.isActive };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(products)
      .set({ isActive: input.isActive, updatedBy: actorUserId })
      .where(eq(products.id, input.productId));

    await writeAuditEvent(tx, {
      actorUserId,
      action: input.isActive ? "product.restored" : "product.archived",
      entityType: "product",
      entityId: input.productId,
      metadata: {
        before: { isActive: target.isActive },
        after: { isActive: input.isActive },
      },
      correlationId,
    });
  });

  return { productId: input.productId, isActive: input.isActive };
}

/**
 * Atomic stock adjustment with an append-only movement row.
 *
 * The balance update is one SQL statement guarded by range predicates, so
 * two concurrent adjustments can never interleave a read-modify-write or
 * drive the balance below zero / above the cap — the loser of the guard
 * simply matches zero rows.
 */
export async function adjustStock(
  input: AdjustStockInput,
  actorUserId: string,
  correlationId: string,
): Promise<AdjustStockResult> {
  const db = getDb();

  const MAX_STOCK = 1_000_000;

  const targetRows = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, input.productId))
    .limit(1);

  if (!targetRows[0]) {
    throw new DomainError("NOT_FOUND", NOT_FOUND_MESSAGE);
  }

  const currentRows = await db
    .select({ isActive: products.isActive })
    .from(products)
    .where(eq(products.id, input.productId))
    .limit(1);

  if (!currentRows[0]) {
    throw new DomainError("NOT_FOUND", NOT_FOUND_MESSAGE);
  }

  if (!currentRows[0].isActive) {
    throw new DomainError(
      "CONFLICT",
      "Stock cannot be adjusted on an archived product.",
    );
  }

  const updatedRows = await db
    .update(products)
    .set({
      stockOnHand: sql`${products.stockOnHand} + ${input.quantityDelta}`,
      updatedBy: actorUserId,
    })
    .where(
      and(
        eq(products.id, input.productId),
        gte(sql`${products.stockOnHand} + ${input.quantityDelta}`, 0),
        lte(sql`${products.stockOnHand} + ${input.quantityDelta}`, MAX_STOCK),
      ),
    )
    .returning({ stockOnHand: products.stockOnHand });

  const updated = updatedRows[0];

  if (!updated) {
    throw new DomainError(
      "INSUFFICIENT_STOCK",
      "Adjustment rejected: the resulting balance would be negative.",
    );
  }

  const newStock = updated.stockOnHand;

  await db.transaction(async (tx) => {
    await tx.insert(stockMovements).values({
      productId: input.productId,
      type: "adjustment",
      quantityDelta: input.quantityDelta,
      resultingStock: newStock,
      reason: input.reason,
      createdBy: actorUserId,
    });

    await writeAuditEvent(tx, {
      actorUserId,
      action: "product.stock_adjusted",
      entityType: "product",
      entityId: input.productId,
      metadata: {
        context: {
          quantityDelta: input.quantityDelta,
          resultingStock: newStock,
          reason: input.reason,
        },
      },
      correlationId,
    });
  });

  return { productId: input.productId, stockOnHand: newStock };
}

/**
 * Drizzle rethrows driver errors wrapped as generic failures with the
 * original PostgresError on `cause`; walk the chain for the 23505 code.
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
