import "server-only";

import { and, eq } from "drizzle-orm";

import type { Database } from "@/db";
import {
  invoices,
  type BillToSnapshot,
  type InvoicePartySnapshot,
} from "@/db/schema";
import { getSellerIdentity } from "@/lib/env/server";
import { DomainError } from "@/lib/errors/action-result";

/**
 * Internal invoice repository. Per the module rules, invoices are created
 * and voided only inside order transactions — never from public actions.
 */

export interface IssuedInvoiceRef {
  invoiceId: string;
  invoiceNumber: string;
}

const INVOICE_NOT_FOUND = "That invoice no longer exists.";

/**
 * Creates the single issued invoice for an order. The amount is captured
 * once from the confirmed order total and can never change afterwards.
 */
export async function createIssuedInvoice(
  tx: Database,
  input: {
    orderId: string;
    subtotalCents: bigint;
    billToSnapshot: BillToSnapshot;
    actorUserId: string;
    correlationId: string;
  },
): Promise<IssuedInvoiceRef> {
  const existing = await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.orderId, input.orderId))
    .limit(1);

  if (existing.length > 0) {
    throw new DomainError("CONFLICT", "This order already has an invoice.");
  }

  const seller: InvoicePartySnapshot = (() => {
    const identity = getSellerIdentity();

    return {
      name: identity.name,
      email: identity.email,
      addressLine1: identity.addressLine1,
      ...(identity.addressLine2 !== undefined
        ? { addressLine2: identity.addressLine2 }
        : {}),
      city: identity.city,
      ...(identity.region !== undefined ? { region: identity.region } : {}),
      postalCode: identity.postalCode,
      countryCode: identity.countryCode,
    };
  })();

  const inserted = await tx
    .insert(invoices)
    .values({
      orderId: input.orderId,
      status: "issued",
      sellerSnapshot: seller,
      billToSnapshot: input.billToSnapshot,
      // No tax or discount model exists: total equals subtotal by design.
      subtotalCents: input.subtotalCents,
      totalCents: input.subtotalCents,
      createdBy: input.actorUserId,
    })
    .returning({ id: invoices.id, invoiceNumber: invoices.invoiceNumber });

  const invoice = inserted[0];

  if (!invoice) {
    throw new DomainError("INTERNAL_ERROR", "Invoice could not be issued.");
  }

  return { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber };
}

/** Marks an issued invoice voided. Voiding is final; amounts never change. */
export async function voidIssuedInvoice(
  tx: Database,
  input: { orderId: string; actorUserId: string },
): Promise<IssuedInvoiceRef> {
  const updated = await tx
    .update(invoices)
    .set({ status: "void", voidedAt: new Date() })
    .where(
      and(eq(invoices.orderId, input.orderId), eq(invoices.status, "issued")),
    )
    .returning({ id: invoices.id, invoiceNumber: invoices.invoiceNumber });

  const invoice = updated[0];

  if (!invoice) {
    throw new DomainError("CONFLICT", INVOICE_NOT_FOUND);
  }

  return { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber };
}
