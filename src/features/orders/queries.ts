import "server-only";

import { and, asc, count, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { getDb } from "@/db";
import { customers, orderLineItems, orders, users } from "@/db/schema";

import { listOrdersQuerySchema } from "./schemas";

import type {
  ListOrdersQuery,
  ListOrdersQueryInput,
  OrderDetailView,
  OrderListPage,
  OrderListRow,
} from "./schemas";

/**
 * Role-projected order reads.
 *
 * `includeTotals` is the financial projection switch: Inventory users work
 * orders without seeing money, so every total is null on that path. Filters
 * cover status scope, customer, creator, and an inclusive created-at date
 * range.
 */

export interface OrderReadOptions {
  includeTotals: boolean;
}

function buildConditions(query: ListOrdersQuery): SQL | undefined {
  const conditions: SQL[] = [];

  if (query.status !== "all") {
    conditions.push(eq(orders.status, query.status));
  }

  if (query.customerId !== undefined) {
    conditions.push(eq(orders.customerId, query.customerId));
  }

  if (query.createdBy !== undefined) {
    conditions.push(eq(orders.createdBy, query.createdBy));
  }

  if (query.dateFrom !== undefined) {
    conditions.push(
      gte(orders.createdAt, new Date(`${query.dateFrom}T00:00:00.000Z`)),
    );
  }

  if (query.dateTo !== undefined) {
    conditions.push(
      lte(orders.createdAt, new Date(`${query.dateTo}T23:59:59.999Z`)),
    );
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

function orderByFor(sort: ListOrdersQuery["sort"]): SQL[] {
  switch (sort) {
    case "oldest":
      return [asc(orders.createdAt)];
    case "total_desc":
      return [desc(orders.totalCents), desc(orders.createdAt)];
    case "total_asc":
      return [asc(orders.totalCents), desc(orders.createdAt)];
    case "newest":
    default:
      return [desc(orders.createdAt)];
  }
}

export async function listOrders(
  rawQuery: ListOrdersQueryInput,
  options: OrderReadOptions,
): Promise<OrderListPage> {
  const query: ListOrdersQuery = listOrdersQuerySchema.parse(rawQuery);
  const db = getDb();
  const where = buildConditions(query);

  const creatorUsers = users;

  const [countRows, rows] = await Promise.all([
    db.select({ value: count() }).from(orders).where(where),
    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        version: orders.version,
        totalCents: orders.totalCents,
        createdAt: orders.createdAt,
        confirmedAt: orders.confirmedAt,
        customerName: customers.name,
        customerCompanyName: customers.companyName,
        creatorName: creatorUsers.displayName,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .leftJoin(creatorUsers, eq(creatorUsers.id, orders.createdBy))
      .where(where)
      .orderBy(...orderByFor(query.sort))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
  ]);

  const total = countRows[0]?.value ?? 0;

  const serialized: OrderListRow[] = rows.map((row) => ({
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    version: row.version,
    customerName: row.customerName,
    customerCompanyName: row.customerCompanyName,
    creatorName: row.creatorName,
    totalCents: options.includeTotals ? Number(row.totalCents) : null,
    createdAt: row.createdAt.toISOString(),
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
  }));

  return {
    rows: serialized,
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

/**
 * Full order detail with immutable snapshot lines and actor projections.
 * Returns null when the order does not exist.
 */
export async function getOrder(
  orderId: string,
  options: OrderReadOptions,
): Promise<OrderDetailView | null> {
  const db = getDb();

  const rows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      version: orders.version,
      totalCents: orders.totalCents,
      currencyCode: orders.currencyCode,
      notes: orders.notes,
      cancellationReason: orders.cancellationReason,
      createdAt: orders.createdAt,
      confirmedAt: orders.confirmedAt,
      fulfilledAt: orders.fulfilledAt,
      cancelledAt: orders.cancelledAt,
      customerId: customers.id,
      customerName: customers.name,
      customerCompanyName: customers.companyName,
      customerEmail: customers.email,
    })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(eq(orders.id, orderId))
    .limit(1);

  const row = rows[0];

  if (!row) {
    return null;
  }

  const creator = alias(users, "creator");
  const confirmer = alias(users, "confirmer");
  const fulfiller = alias(users, "fulfiller");
  const canceller = alias(users, "canceller");

  const actorsRows = await db
    .select({
      creatorName: creator.displayName,
      confirmedByName: confirmer.displayName,
      fulfilledByName: fulfiller.displayName,
      cancelledByName: canceller.displayName,
    })
    .from(orders)
    .leftJoin(creator, eq(creator.id, orders.createdBy))
    .leftJoin(confirmer, eq(confirmer.id, orders.confirmedBy))
    .leftJoin(fulfiller, eq(fulfiller.id, orders.fulfilledBy))
    .leftJoin(canceller, eq(canceller.id, orders.cancelledBy))
    .where(eq(orders.id, orderId))
    .limit(1);

  const actors = actorsRows[0];

  const lineRows = await db
    .select({
      id: orderLineItems.id,
      productId: orderLineItems.productId,
      productSku: orderLineItems.productSku,
      productName: orderLineItems.productName,
      quantity: orderLineItems.quantity,
      unitPriceCents: orderLineItems.unitPriceCents,
      lineTotalCents: orderLineItems.lineTotalCents,
    })
    .from(orderLineItems)
    .where(eq(orderLineItems.orderId, orderId))
    .orderBy(asc(orderLineItems.createdAt), asc(orderLineItems.id));

  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    version: row.version,
    customerId: row.customerId,
    customerName: row.customerName,
    customerCompanyName: row.customerCompanyName,
    customerEmail: row.customerEmail,
    totalCents: options.includeTotals ? Number(row.totalCents) : null,
    currencyCode: row.currencyCode,
    notes: row.notes,
    cancellationReason: row.cancellationReason,
    lines: lineRows.map((line) => ({
      id: line.id,
      productId: line.productId,
      productSku: line.productSku,
      productName: line.productName,
      quantity: line.quantity,
      unitPriceCents: Number(line.unitPriceCents),
      lineTotalCents: Number(line.lineTotalCents),
    })),
    creatorName: actors?.creatorName ?? null,
    confirmedByName: actors?.confirmedByName ?? null,
    fulfilledByName: actors?.fulfilledByName ?? null,
    cancelledByName: actors?.cancelledByName ?? null,
    createdAt: row.createdAt.toISOString(),
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    fulfilledAt: row.fulfilledAt ? row.fulfilledAt.toISOString() : null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
  };
}
