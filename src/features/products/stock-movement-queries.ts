import "server-only";

import { and, asc, count, desc, eq, sql, type SQL } from "drizzle-orm";

import { getDb } from "@/db";
import { orders, products, stockMovements, users } from "@/db/schema";

import { listStockMovementsQuerySchema } from "./stock-movement-schemas";

import type {
  ListStockMovementsQuery,
  ListStockMovementsQueryInput,
  StockMovementPage,
  StockMovementRow,
} from "./stock-movement-schemas";

/**
 * Paginated append-only movement history.
 *
 * Filters compose additively: product scope (product detail page), movement
 * type, actor, inclusive date range, and exact order-number lookup for the
 * cross-product audit trail.  Left joins keep non-order movements visible
 * while still resolving order numbers when present.
 */

function buildConditions(query: ListStockMovementsQuery): SQL | undefined {
  const conditions: SQL[] = [];

  if (query.productId !== undefined) {
    conditions.push(eq(stockMovements.productId, query.productId));
  }

  if (query.type !== undefined) {
    conditions.push(eq(stockMovements.type, query.type));
  }

  if (query.actorId !== undefined) {
    conditions.push(eq(stockMovements.createdBy, query.actorId));
  }

  if (query.from !== undefined) {
    conditions.push(sql`${stockMovements.createdAt} >= ${query.from}::date`);
  }

  if (query.to !== undefined) {
    conditions.push(
      sql`${stockMovements.createdAt} < (${query.to}::date + interval '1 day')`,
    );
  }

  if (query.orderNumber !== undefined) {
    conditions.push(
      sql`lower(${orders.orderNumber}) = lower(${query.orderNumber})`,
    );
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

function orderByFor(sort: ListStockMovementsQuery["sort"]): SQL[] {
  switch (sort) {
    case "oldest":
      return [asc(stockMovements.createdAt), asc(stockMovements.id)];
    case "delta_asc":
      return [
        asc(stockMovements.quantityDelta),
        desc(stockMovements.createdAt),
      ];
    case "delta_desc":
      return [
        desc(stockMovements.quantityDelta),
        desc(stockMovements.createdAt),
      ];
    case "newest":
    default:
      return [desc(stockMovements.createdAt), desc(stockMovements.id)];
  }
}

export async function listStockMovements(
  rawQuery: ListStockMovementsQueryInput,
): Promise<StockMovementPage> {
  const query: ListStockMovementsQuery =
    listStockMovementsQuerySchema.parse(rawQuery);
  const db = getDb();
  const where = buildConditions(query);

  const [countRows, rows] = await Promise.all([
    db
      .select({ value: count() })
      .from(stockMovements)
      .leftJoin(orders, eq(orders.id, stockMovements.orderId))
      .where(where),
    db
      .select({
        id: stockMovements.id,
        productId: stockMovements.productId,
        productSku: products.sku,
        productName: products.name,
        type: stockMovements.type,
        quantityDelta: stockMovements.quantityDelta,
        resultingStock: stockMovements.resultingStock,
        reason: stockMovements.reason,
        orderId: stockMovements.orderId,
        orderNumber: orders.orderNumber,
        actorId: stockMovements.createdBy,
        actorName: users.displayName,
        createdAt: stockMovements.createdAt,
      })
      .from(stockMovements)
      .innerJoin(products, eq(products.id, stockMovements.productId))
      .leftJoin(orders, eq(orders.id, stockMovements.orderId))
      .innerJoin(users, eq(users.id, stockMovements.createdBy))
      .where(where)
      .orderBy(...orderByFor(query.sort))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
  ]);

  const total = countRows[0]?.value ?? 0;

  const serialized: StockMovementRow[] = rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));

  return {
    rows: serialized,
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}
