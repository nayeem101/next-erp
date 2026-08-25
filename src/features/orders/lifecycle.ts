import "server-only";

import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { orderLineItems, orders } from "@/db/schema";
import { AUDIT_ACTIONS } from "@/lib/audit/events";
import { writeAuditEvent } from "@/lib/audit/writer";
import { DomainError } from "@/lib/errors/action-result";

import { voidIssuedInvoice } from "./invoices";
import { postSaleReversalJournal } from "./ledger";
import { restoreSaleStock } from "./stock";

import type {
  CancelOrderInput,
  CancelOrderResult,
  TransitionOrderInput,
  TransitionOrderResult,
} from "./schemas";

/**
 * Terminal-path transitions. Fulfillment is a pure status move (stock was
 * deducted at confirmation); cancellation branches on the current state —
 * drafts cancel cleanly while confirmed orders reverse every side effect.
 */

const ORDER_NOT_FOUND = "That order no longer exists.";

function staleVersion(): DomainError {
  return new DomainError(
    "CONFLICT",
    "This order changed while you were working. Reload and try again.",
  );
}

export async function fulfillOrder(
  input: TransitionOrderInput,
  actorUserId: string,
  correlationId: string,
): Promise<TransitionOrderResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const lockedRows = await tx
      .select({
        id: orders.id,
        status: orders.status,
        version: orders.version,
        customerId: orders.customerId,
      })
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .for("update")
      .limit(1);

    const order = lockedRows[0];

    if (!order) {
      throw new DomainError("NOT_FOUND", ORDER_NOT_FOUND);
    }

    if (order.status !== "confirmed") {
      throw new DomainError(
        "CONFLICT",
        "Only confirmed orders can be fulfilled.",
      );
    }

    if (order.version !== input.version) {
      throw staleVersion();
    }

    const nextVersion = order.version + 1;

    await tx
      .update(orders)
      .set({
        status: "fulfilled",
        version: nextVersion,
        fulfilledBy: actorUserId,
        fulfilledAt: new Date(),
      })
      .where(eq(orders.id, order.id));

    await writeAuditEvent(tx, {
      actorUserId,
      action: AUDIT_ACTIONS.orderFulfilled,
      entityType: "order",
      entityId: order.id,
      metadata: {
        after: { status: "fulfilled", version: nextVersion },
      },
      correlationId,
    });

    // No stock or ledger movement: those happened at confirmation.
    return {
      orderId: order.id,
      customerId: order.customerId,
      version: nextVersion,
      status: "fulfilled",
    };
  });
}

export async function cancelOrder(
  input: CancelOrderInput,
  actorUserId: string,
  correlationId: string,
): Promise<CancelOrderResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const lockedRows = await tx
      .select({
        id: orders.id,
        status: orders.status,
        version: orders.version,
        totalCents: orders.totalCents,
        orderNumber: orders.orderNumber,
        customerId: orders.customerId,
      })
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .for("update")
      .limit(1);

    const order = lockedRows[0];

    if (!order) {
      throw new DomainError("NOT_FOUND", ORDER_NOT_FOUND);
    }

    if (order.status === "fulfilled" || order.status === "cancelled") {
      throw new DomainError(
        "CONFLICT",
        `A ${order.status} order can no longer be cancelled.`,
      );
    }

    if (order.version !== input.version) {
      throw staleVersion();
    }

    const nextVersion = order.version + 1;
    let reversed = false;

    if (order.status === "confirmed") {
      // Reverse the sale: restock, void invoice, reversal journal.
      const lines = await tx
        .select({
          productId: orderLineItems.productId,
          quantity: orderLineItems.quantity,
        })
        .from(orderLineItems)
        .where(eq(orderLineItems.orderId, order.id));

      await restoreSaleStock(tx, {
        orderId: order.id,
        lines,
        reason: `${order.orderNumber} cancellation`,
        actorUserId,
      });

      const invoice = await voidIssuedInvoice(tx, {
        orderId: order.id,
        actorUserId,
      });

      const journal = await postSaleReversalJournal(tx, {
        orderId: order.id,
        invoiceId: invoice.invoiceId,
        amountCents: order.totalCents,
        postedBy: actorUserId,
        description: `Reversal for ${order.orderNumber}`,
      });

      await writeAuditEvent(tx, {
        actorUserId,
        action: AUDIT_ACTIONS.invoiceVoided,
        entityType: "invoice",
        entityId: invoice.invoiceId,
        metadata: {
          after: { orderId: order.id, invoiceNumber: invoice.invoiceNumber },
        },
        correlationId,
      });

      await writeAuditEvent(tx, {
        actorUserId,
        action: AUDIT_ACTIONS.ledgerSaleReversed,
        entityType: "ledger_journal",
        entityId: journal.journalId,
        metadata: {
          after: {
            journalType: "sale_reversal",
            amountCents: order.totalCents.toString(),
            invoiceId: invoice.invoiceId,
          },
        },
        correlationId,
      });

      reversed = true;
    }

    await tx
      .update(orders)
      .set({
        status: "cancelled",
        version: nextVersion,
        cancellationReason: input.reason,
        cancelledBy: actorUserId,
        cancelledAt: new Date(),
      })
      .where(eq(orders.id, order.id));

    await writeAuditEvent(tx, {
      actorUserId,
      action: AUDIT_ACTIONS.orderCancelled,
      entityType: "order",
      entityId: order.id,
      metadata: {
        after: {
          status: "cancelled",
          version: nextVersion,
          reversed,
        },
        reason: input.reason,
      },
      correlationId,
    });

    return {
      orderId: order.id,
      customerId: order.customerId,
      version: nextVersion,
      status: "cancelled",
      reversed,
    };
  });
}

/** Shared guard for edit-page and action-slot use: is this still draft? */
export async function loadDraftForEdit(orderId: string): Promise<boolean> {
  const db = getDb();

  const rows = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  return rows[0]?.status === "draft";
}
