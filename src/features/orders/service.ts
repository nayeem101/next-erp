import "server-only";

import { eq, inArray } from "drizzle-orm";

import { getDb } from "@/db";
import { customers, orderLineItems, orders, products } from "@/db/schema";
import { writeAuditEvent } from "@/lib/audit/writer";
import { DomainError } from "@/lib/errors/action-result";

import { buildLineSnapshots, computeOrderTotalCents } from "./domain";

import type { ProductMasterData } from "./domain";
import type {
  CreateDraftOrderInput,
  CreateDraftOrderResult,
  UpdateDraftOrderInput,
  UpdateDraftOrderResult,
} from "./schemas";

/**
 * Draft order workflows.
 *
 * Clients never send money: the service reads current product master data
 * inside the transaction, builds immutable snapshots with exact bigint math,
 * and computes totals server-side. Draft writes never touch stock, invoices,
 * or ledger entries — those belong exclusively to confirmation/cancellation.
 */

const CUSTOMER_NOT_FOUND = "That customer no longer exists.";
const ORDER_NOT_FOUND = "That order no longer exists.";

async function resolveActiveCustomer(
  customerId: string,
): Promise<{ id: string }> {
  const db = getDb();

  const rows = await db
    .select({ id: customers.id, isActive: customers.isActive })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  const customer = rows[0];

  if (!customer) {
    throw new DomainError("NOT_FOUND", CUSTOMER_NOT_FOUND);
  }

  if (!customer.isActive) {
    throw new DomainError(
      "CONFLICT",
      "Orders require an active customer. Restore the customer first.",
    );
  }

  return { id: customer.id };
}

/** Adapts resolved rows into the pure snapshot builder's master map. */
function resolvedMasterData(
  lines: ResolvedProductLine[],
): Map<string, ProductMasterData> {
  return new Map(
    lines.map((line) => [
      line.productId,
      {
        productId: line.productId,
        sku: line.sku,
        name: line.name,
        unitPriceCents: line.unitPriceCents,
      },
    ]),
  );
}

interface ResolvedProductLine {
  productId: string;
  quantity: number;
  sku: string;
  name: string;
  unitPriceCents: bigint;
}

/** Loads master data for every requested product in one query. */
async function resolveProducts(
  lines: CreateDraftOrderInput["lines"],
): Promise<ResolvedProductLine[]> {
  const db = getDb();
  const productIds = lines.map((line) => line.productId);

  const rows = await db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      unitPriceCents: products.unitPriceCents,
      isActive: products.isActive,
    })
    .from(products)
    .where(inArray(products.id, productIds));

  const byId = new Map(rows.map((row) => [row.id, row]));

  return lines.map((line) => {
    const product = byId.get(line.productId);

    if (!product) {
      throw new DomainError(
        "NOT_FOUND",
        "A selected product no longer exists.",
      );
    }

    if (!product.isActive) {
      throw new DomainError(
        "CONFLICT",
        `${product.sku} is archived and cannot be ordered.`,
      );
    }

    return {
      productId: product.id,
      quantity: line.quantity,
      sku: product.sku,
      name: product.name,
      unitPriceCents: product.unitPriceCents,
    };
  });
}

export async function createDraftOrder(
  input: CreateDraftOrderInput,
  actorUserId: string,
  correlationId: string,
): Promise<CreateDraftOrderResult> {
  await resolveActiveCustomer(input.customerId);
  const resolvedLines = await resolveProducts(input.lines);

  const snapshots = buildLineSnapshots(
    input.lines,
    resolvedMasterData(resolvedLines),
  );

  const totalCents = computeOrderTotalCents(snapshots);
  const db = getDb();

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(orders)
      .values({
        customerId: input.customerId,
        status: "draft",
        version: 1,
        totalCents,
        notes: input.notes ?? null,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })
      .returning({ id: orders.id, orderNumber: orders.orderNumber });

    const order = inserted[0];

    if (!order) {
      throw new DomainError("INTERNAL_ERROR", "Order could not be created.");
    }

    await tx.insert(orderLineItems).values(
      snapshots.map((snapshot) => ({
        orderId: order.id,
        productId: snapshot.productId,
        productSku: snapshot.productSku,
        productName: snapshot.productName,
        quantity: snapshot.quantity,
        unitPriceCents: snapshot.unitPriceCents,
        lineTotalCents: snapshot.lineTotalCents,
      })),
    );

    await writeAuditEvent(tx, {
      actorUserId,
      action: "order.draft_created",
      entityType: "order",
      entityId: order.id,
      metadata: {
        after: {
          customerId: input.customerId,
          lineCount: snapshots.length,
          totalCents: totalCents.toString(),
        },
      },
      correlationId,
    });

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      version: 1,
      totalCents: Number(totalCents),
    };
  });
}

/**
 * Draft-only full replacement with optimistic concurrency.  Line snapshots
 * are rebuilt from current master data so price changes flow into saved
 * drafts; the caller's `version` must still match or the write fails.
 */
export async function updateDraftOrder(
  input: UpdateDraftOrderInput,
  actorUserId: string,
  correlationId: string,
): Promise<UpdateDraftOrderResult> {
  const db = getDb();

  const existingRows = await db
    .select({
      id: orders.id,
      status: orders.status,
      version: orders.version,
    })
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .limit(1);

  const existing = existingRows[0];

  if (!existing) {
    throw new DomainError("NOT_FOUND", ORDER_NOT_FOUND);
  }

  if (existing.status !== "draft") {
    throw new DomainError("CONFLICT", "Only draft orders can be edited.");
  }

  if (existing.version !== input.version) {
    throw new DomainError(
      "CONFLICT",
      "This order changed while you were editing it. Reload and try again.",
    );
  }

  await resolveActiveCustomer(input.customerId);
  const resolvedLines = await resolveProducts(input.lines);

  const snapshots = buildLineSnapshots(
    input.lines,
    resolvedMasterData(resolvedLines),
  );
  const totalCents = computeOrderTotalCents(snapshots);
  const nextVersion = input.version + 1;

  return db.transaction(async (tx) => {
    // Conditional update re-checks the version inside the transaction so a
    // racing writer cannot slip between the read and this write.
    const updated = await tx
      .update(orders)
      .set({
        customerId: input.customerId,
        totalCents,
        notes: input.notes ?? null,
        updatedBy: actorUserId,
        version: nextVersion,
      })
      .where(eq(orders.id, input.orderId))
      .returning({ id: orders.id, version: orders.version });

    const row = updated[0];

    if (!row) {
      throw new DomainError(
        "CONFLICT",
        "This order changed while you were editing it. Reload and try again.",
      );
    }

    await tx
      .delete(orderLineItems)
      .where(eq(orderLineItems.orderId, input.orderId));

    await tx.insert(orderLineItems).values(
      snapshots.map((snapshot) => ({
        orderId: input.orderId,
        productId: snapshot.productId,
        productSku: snapshot.productSku,
        productName: snapshot.productName,
        quantity: snapshot.quantity,
        unitPriceCents: snapshot.unitPriceCents,
        lineTotalCents: snapshot.lineTotalCents,
      })),
    );

    await writeAuditEvent(tx, {
      actorUserId,
      action: "order.draft_updated",
      entityType: "order",
      entityId: input.orderId,
      metadata: {
        after: {
          lineCount: snapshots.length,
          totalCents: totalCents.toString(),
          version: nextVersion,
        },
      },
      correlationId,
    });

    return {
      orderId: input.orderId,
      version: nextVersion,
      totalCents: Number(totalCents),
    };
  });
}
