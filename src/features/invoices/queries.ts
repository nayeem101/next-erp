import "server-only";

import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";

import { getDb } from "@/db";
import { customers, invoices, orders } from "@/db/schema";

import { listInvoicesQuerySchema } from "./schemas";

import type { ListInvoicesQuery, ListInvoicesQueryInput } from "./schemas";

/**
 * Invoice read models for Admin/Sales. Invoices never exist without an
 * order, so every row carries its order reference for drill-through.
 */

export interface InvoiceListRow {
  id: string;
  invoiceNumber: string;
  status: "issued" | "void";
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  totalCents: number;
  issuedAt: string;
  voidedAt: string | null;
}

export interface InvoiceListPage {
  rows: InvoiceListRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface InvoiceDetailRow {
  id: string;
  invoiceNumber: string;
  status: "issued" | "void";
  currencyCode: string;
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  sellerSnapshot: {
    name: string;
    email: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    region?: string;
    postalCode: string;
    countryCode: string;
  };
  billToSnapshot: {
    name: string;
    email: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    region?: string;
    postalCode: string;
    countryCode: string;
    companyName?: string;
    phone?: string;
  };
  subtotalCents: number;
  totalCents: number;
  issuedAt: string;
  voidedAt: string | null;
}

function buildConditions(query: ListInvoicesQuery): SQL | undefined {
  const conditions: (SQL | undefined)[] = [];

  if (query.status !== "all") {
    conditions.push(eq(invoices.status, query.status));
  }

  if (query.customerId !== undefined) {
    conditions.push(eq(orders.customerId, query.customerId));
  }

  if (query.dateFrom !== undefined) {
    conditions.push(gte(invoices.issuedAt, sql`${query.dateFrom}::date`));
  }

  if (query.dateTo !== undefined) {
    // Inclusive upper bound across the whole day.
    conditions.push(
      lte(invoices.issuedAt, sql`${query.dateTo}::date + interval '1 day'`),
    );
  }

  const defined = conditions.filter((condition) => condition !== undefined);

  return defined.length > 0 ? and(...defined) : undefined;
}

export async function listInvoices(
  rawQuery: ListInvoicesQueryInput,
): Promise<InvoiceListPage> {
  const db = getDb();

  // Parse defensively so callers can pass loose input; defaults apply.
  const query: ListInvoicesQuery = listInvoicesQuerySchema.parse(rawQuery);
  const where = buildConditions(query);
  const offset = (query.page - 1) * query.pageSize;

  const rows = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      customerId: customers.id,
      customerName: customers.name,
      totalCents: sql<string>`${invoices.totalCents}`,
      issuedAt: sql<string>`${invoices.issuedAt}`,
      voidedAt: sql<string | null>`${invoices.voidedAt}`,
    })
    .from(invoices)
    .innerJoin(orders, eq(invoices.orderId, orders.id))
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(where)
    .orderBy(desc(invoices.issuedAt), desc(invoices.id))
    .limit(query.pageSize)
    .offset(offset);

  const totals = await db
    .select({ count: sql<string>`count(*)` })
    .from(invoices)
    .innerJoin(orders, eq(invoices.orderId, orders.id))
    .where(where);

  const count = Number(totals[0]?.count ?? 0);

  return {
    rows: rows.map((row) => ({
      ...row,
      totalCents: Number(row.totalCents),
      issuedAt: new Date(row.issuedAt).toISOString(),
      voidedAt:
        row.voidedAt === null ? null : new Date(row.voidedAt).toISOString(),
    })),
    total: count,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(Math.ceil(count / query.pageSize), 1),
  };
}

export async function getInvoice(
  invoiceId: string,
): Promise<InvoiceDetailRow | null> {
  const db = getDb();

  const rows = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      currencyCode: invoices.currencyCode,
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      customerId: customers.id,
      customerName: customers.name,
      sellerSnapshot: invoices.sellerSnapshot,
      billToSnapshot: invoices.billToSnapshot,
      subtotalCents: sql<string>`${invoices.subtotalCents}`,
      totalCents: sql<string>`${invoices.totalCents}`,
      issuedAt: sql<string>`${invoices.issuedAt}`,
      voidedAt: sql<string | null>`${invoices.voidedAt}`,
    })
    .from(invoices)
    .innerJoin(orders, eq(invoices.orderId, orders.id))
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(eq(invoices.id, invoiceId))
    .limit(1);

  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    ...row,
    subtotalCents: Number(row.subtotalCents),
    totalCents: Number(row.totalCents),
    issuedAt: new Date(row.issuedAt).toISOString(),
    voidedAt:
      row.voidedAt === null ? null : new Date(row.voidedAt).toISOString(),
  };
}

/** Immutable line snapshots for an invoice's underlying order. */
export async function getInvoiceLines(invoiceId: string) {
  const { orderLineItems } = await import("@/db/schema");

  const db = getDb();

  const rows = await db
    .select({
      id: orderLineItems.id,
      productSku: orderLineItems.productSku,
      productName: orderLineItems.productName,
      quantity: orderLineItems.quantity,
      unitPriceCents: sql<string>`${orderLineItems.unitPriceCents}`,
      lineTotalCents: sql<string>`${orderLineItems.lineTotalCents}`,
    })
    .from(orderLineItems)
    .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
    .innerJoin(invoices, eq(orders.id, invoices.orderId))
    .where(eq(invoices.id, invoiceId))
    .orderBy(orderLineItems.createdAt, orderLineItems.id);

  return rows.map((row) => ({
    ...row,
    unitPriceCents: Number(row.unitPriceCents),
    lineTotalCents: Number(row.lineTotalCents),
  }));
}
