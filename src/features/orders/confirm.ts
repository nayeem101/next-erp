import "server-only";

import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import {
  customers,
  orderLineItems,
  orders,
  type BillToSnapshot,
} from "@/db/schema";
import { writeAuditEvent } from "@/lib/audit/writer";
import { DomainError } from "@/lib/errors/action-result";

import { createIssuedInvoice } from "./invoices";
import { postSaleJournal } from "./ledger";
import { assertProductsConfirmable, deductSaleStock } from "./stock";

import type { TransitionOrderInput } from "./schemas";

/** Confirmation returns the issued invoice reference plus new version. */
export interface ConfirmOrderResult {
  orderId: string;
  orderNumber: string;
  customerId: string;
  version: number;
  invoiceId: string;
  invoiceNumber: string;
  totalCents: number;
}

/**
 * Confirmation converts a draft into a confirmed sale in exactly one
 * transaction: stock is deducted conditionally (never negative), one
 * invoice is issued against the customer's current bill-to data, and a
 * balanced sale journal is posted. Any failure rolls back everything.
 */

const ORDER_NOT_FOUND = "That order no longer exists.";

export async function confirmOrder(
  input: TransitionOrderInput,
  actorUserId: string,
  correlationId: string,
): Promise<ConfirmOrderResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    // Lock the draft row so competing confirmations serialize here.
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

    if (order.status !== "draft") {
      throw new DomainError("CONFLICT", "Only draft orders can be confirmed.");
    }

    if (order.version !== input.version) {
      throw new DomainError(
        "CONFLICT",
        "This order changed while you were working. Reload and try again.",
      );
    }

    // Customer must still exist and be active.
    const customerRows = await tx
      .select({
        id: customers.id,
        isActive: customers.isActive,
        name: customers.name,
        email: customers.email,
        phone: customers.phone,
        companyName: customers.companyName,
        addressLine1: customers.addressLine1,
        addressLine2: customers.addressLine2,
        city: customers.city,
        region: customers.region,
        postalCode: customers.postalCode,
        countryCode: customers.countryCode,
      })
      .from(customers)
      .where(eq(customers.id, order.customerId))
      .for("update")
      .limit(1);

    const customer = customerRows[0];

    if (!customer) {
      throw new DomainError("NOT_FOUND", "That customer no longer exists.");
    }

    if (!customer.isActive) {
      throw new DomainError(
        "CONFLICT",
        "Orders require an active customer. Restore the customer first.",
      );
    }

    const lines = await tx
      .select({
        productId: orderLineItems.productId,
        quantity: orderLineItems.quantity,
      })
      .from(orderLineItems)
      .where(eq(orderLineItems.orderId, order.id));

    if (lines.length === 0) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "Orders need at least one line.",
      );
    }

    await assertProductsConfirmable(
      tx,
      lines.map((line) => line.productId),
    );

    // Deduct with conditional updates; aborts on insufficient stock.
    await deductSaleStock(tx, {
      orderId: order.id,
      lines,
      reason: `${order.orderNumber} confirmation`,
      actorUserId,
    });

    const nextVersion = order.version + 1;

    await tx
      .update(orders)
      .set({
        status: "confirmed",
        version: nextVersion,
        confirmedBy: actorUserId,
        confirmedAt: new Date(),
      })
      .where(eq(orders.id, order.id));

    const billTo: BillToSnapshot = {
      name: customer.name,
      email: customer.email,
      ...(customer.companyName !== null
        ? { companyName: customer.companyName }
        : {}),
      addressLine1: customer.addressLine1,
      ...(customer.addressLine2 !== null
        ? { addressLine2: customer.addressLine2 }
        : {}),
      city: customer.city,
      ...(customer.region !== null ? { region: customer.region } : {}),
      postalCode: customer.postalCode,
      countryCode: customer.countryCode,
      ...(customer.phone !== null ? { phone: customer.phone } : {}),
    };

    const invoice = await createIssuedInvoice(tx, {
      orderId: order.id,
      subtotalCents: order.totalCents,
      billToSnapshot: billTo,
      actorUserId,
      correlationId,
    });

    const journal = await postSaleJournal(tx, {
      orderId: order.id,
      invoiceId: invoice.invoiceId,
      amountCents: order.totalCents,
      postedBy: actorUserId,
      description: `Sale for ${order.orderNumber}`,
    });

    await writeAuditEvent(tx, {
      actorUserId,
      action: "order.confirmed",
      entityType: "order",
      entityId: order.id,
      metadata: {
        after: {
          status: "confirmed",
          version: nextVersion,
          totalCents: order.totalCents.toString(),
          invoiceId: invoice.invoiceId,
        },
      },
      correlationId,
    });

    await writeAuditEvent(tx, {
      actorUserId,
      action: "invoice.issued",
      entityType: "invoice",
      entityId: invoice.invoiceId,
      metadata: {
        after: {
          orderId: order.id,
          invoiceNumber: invoice.invoiceNumber,
          totalCents: order.totalCents.toString(),
        },
      },
      correlationId,
    });

    await writeAuditEvent(tx, {
      actorUserId,
      action: "ledger.sale_posted",
      entityType: "ledger_journal",
      entityId: journal.journalId,
      metadata: {
        after: {
          journalType: "sale",
          amountCents: order.totalCents.toString(),
          invoiceId: invoice.invoiceId,
        },
      },
      correlationId,
    });

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerId: order.customerId,
      version: nextVersion,
      invoiceId: invoice.invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      totalCents: Number(order.totalCents),
    };
  });
}
