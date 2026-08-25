import "server-only";

import { eq, inArray, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { products, stockMovements } from "@/db/schema";
import { DomainError } from "@/lib/errors/action-result";

/**
 * Confirm/cancel stock mechanics. Deduction uses one conditional
 * `stock_on_hand >= qty` UPDATE per product inside the caller's
 * transaction; a failed conditional update means insufficient stock and
 * aborts the whole confirm. Lock ordering is deterministic (product ID
 * ascending) so competing confirmations serialize instead of deadlocking.
 */

export interface StockLineRequest {
  productId: string;
  quantity: number;
}

export interface AppliedStockMovement {
  productId: string;
  quantityDelta: number;
  resultingStock: number;
}

export interface InsufficientStockDetail {
  productId: string;
  requested: number;
  available: number;
}

const INSUFFICIENT_STOCK = "Not enough stock for some products in this order.";

function sortedByProductId(lines: StockLineRequest[]): StockLineRequest[] {
  return [...lines].sort((a, b) => a.productId.localeCompare(b.productId));
}

/**
 * Deducts every line's quantity in stable product-ID order. Returns the
 * movement rows to persist (delta negative, with the post-update balance).
 */
export async function deductSaleStock(
  tx: Database,
  input: {
    orderId: string;
    lines: StockLineRequest[];
    reason: string;
    actorUserId: string;
  },
): Promise<AppliedStockMovement[]> {
  if (input.lines.length === 0) {
    throw new DomainError("VALIDATION_ERROR", "Orders need at least one line.");
  }

  const ordered = sortedByProductId(input.lines);
  const applied: AppliedStockMovement[] = [];

  for (const line of ordered) {
    const updated = await tx
      .update(products)
      .set({
        stockOnHand: sql`${products.stockOnHand} - ${line.quantity}`,
      })
      .where(
        // The conditional is the guard against overselling.
        sql`${products.id} = ${line.productId}::uuid and ${products.stockOnHand} >= ${line.quantity}`,
      )
      .returning({ stockOnHand: products.stockOnHand });

    const row = updated[0];

    if (!row) {
      // Read current availability for a safe, per-product message.
      const current = await tx
        .select({ stockOnHand: products.stockOnHand })
        .from(products)
        .where(eq(products.id, line.productId))
        .limit(1);

      throw new InsufficientStockError([
        {
          productId: line.productId,
          requested: line.quantity,
          available: current[0]?.stockOnHand ?? 0,
        },
      ]);
    }

    applied.push({
      productId: line.productId,
      quantityDelta: -line.quantity,
      resultingStock: row.stockOnHand,
    });
  }

  await tx.insert(stockMovements).values(
    applied.map((movement) => ({
      productId: movement.productId,
      orderId: input.orderId,
      type: "sale" as const,
      quantityDelta: movement.quantityDelta,
      resultingStock: movement.resultingStock,
      reason: input.reason,
      createdBy: input.actorUserId,
    })),
  );

  return applied;
}

/**
 * Restores each line's quantity in stable order and writes positive
 * `sale_reversal` movements. Used only by confirmed-order cancellation.
 */
export async function restoreSaleStock(
  tx: Database,
  input: {
    orderId: string;
    lines: StockLineRequest[];
    reason: string;
    actorUserId: string;
  },
): Promise<AppliedStockMovement[]> {
  if (input.lines.length === 0) {
    throw new DomainError("VALIDATION_ERROR", "Orders need at least one line.");
  }

  const ordered = sortedByProductId(input.lines);
  const applied: AppliedStockMovement[] = [];

  for (const line of ordered) {
    const updated = await tx
      .update(products)
      .set({ stockOnHand: sql`${products.stockOnHand} + ${line.quantity}` })
      .where(eq(products.id, line.productId))
      .returning({ stockOnHand: products.stockOnHand });

    const row = updated[0];

    if (!row) {
      throw new DomainError("NOT_FOUND", "A product no longer exists.");
    }

    applied.push({
      productId: line.productId,
      quantityDelta: line.quantity,
      resultingStock: row.stockOnHand,
    });
  }

  await tx.insert(stockMovements).values(
    applied.map((movement) => ({
      productId: movement.productId,
      orderId: input.orderId,
      type: "sale_reversal" as const,
      quantityDelta: movement.quantityDelta,
      resultingStock: movement.resultingStock,
      reason: input.reason,
      createdBy: input.actorUserId,
    })),
  );

  return applied;
}

/** Typed error carrying safe per-product availability details. */
export class InsufficientStockError extends DomainError {
  readonly lines: InsufficientStockDetail[];

  constructor(details: InsufficientStockDetail[]) {
    super("INSUFFICIENT_STOCK", INSUFFICIENT_STOCK, {
      details: {
        insufficient: details.map((detail) => ({
          productId: detail.productId,
          requested: detail.requested,
          available: detail.available,
        })),
      },
    });
    this.name = "InsufficientStockError";
    this.lines = details;
  }
}

/** Verifies all requested products still exist and are active. */
export async function assertProductsConfirmable(
  tx: Database,
  productIds: string[],
): Promise<void> {
  if (productIds.length === 0) {
    throw new DomainError("VALIDATION_ERROR", "Orders need at least one line.");
  }

  const rows = await tx
    .select({ id: products.id, isActive: products.isActive })
    .from(products)
    .where(inArray(products.id, productIds));

  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const productId of productIds) {
    const product = byId.get(productId);

    if (!product) {
      throw new DomainError(
        "NOT_FOUND",
        "A selected product no longer exists.",
      );
    }

    if (!product.isActive) {
      throw new DomainError(
        "CONFLICT",
        "An archived product cannot be ordered.",
      );
    }
  }
}
