import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { getDb } from "@/db";
import { categories, products } from "@/db/schema";
import { ilikeContainsPattern } from "@/lib/list-query/escape";

import { listProductsQuerySchema } from "./schemas";

import type {
  ListProductsQuery,
  ListProductsQueryInput,
  ProductListPage,
  ProductListRow,
} from "./schemas";

/**
 * Paginated product catalog with category names and stock projections.
 *
 * Filters compose: text search across SKU/name (escaped), category scope,
 * lifecycle status, and a low-stock projection (active items at or below
 * their reorder level).
 */

function buildConditions(query: ListProductsQuery): SQL | undefined {
  const conditions: SQL[] = [];

  if (query.stockStatus === "active") {
    conditions.push(eq(products.isActive, true));
  } else if (query.stockStatus === "archived") {
    conditions.push(eq(products.isActive, false));
  } else if (query.stockStatus === "low_stock") {
    const lowStock = and(
      eq(products.isActive, true),
      sql`${products.stockOnHand} <= ${products.reorderLevel}`,
    );

    if (lowStock) {
      conditions.push(lowStock);
    }
  }

  if (query.categoryId !== undefined) {
    conditions.push(eq(products.categoryId, query.categoryId));
  }

  if (query.search !== undefined) {
    const pattern = ilikeContainsPattern(query.search);

    const skuOrName = or(
      ilike(products.sku, pattern),
      ilike(products.name, pattern),
    );

    if (skuOrName) {
      conditions.push(skuOrName);
    }
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

function orderByFor(sort: ListProductsQuery["sort"]): SQL[] {
  switch (sort) {
    case "name_desc":
      return [desc(sql`lower(${products.name})`)];
    case "sku":
      return [asc(products.sku)];
    case "newest":
      return [desc(products.createdAt)];
    case "price_asc":
      return [asc(products.unitPriceCents)];
    case "price_desc":
      return [desc(products.unitPriceCents)];
    case "stock_asc":
      return [asc(products.stockOnHand), asc(sql`lower(${products.name})`)];
    case "name":
    default:
      return [asc(sql`lower(${products.name})`)];
  }
}

export async function listProducts(
  rawQuery: ListProductsQueryInput,
): Promise<ProductListPage> {
  const query: ListProductsQuery = listProductsQuerySchema.parse(rawQuery);
  const db = getDb();
  const where = buildConditions(query);

  const [countRows, rows] = await Promise.all([
    db.select({ value: count() }).from(products).where(where),
    db
      .select({
        id: products.id,
        categoryId: products.categoryId,
        categoryName: categories.name,
        sku: products.sku,
        name: products.name,
        description: products.description,
        unitPriceCents: products.unitPriceCents,
        stockOnHand: products.stockOnHand,
        reorderLevel: products.reorderLevel,
        isActive: products.isActive,
        createdAt: products.createdAt,
      })
      .from(products)
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .where(where)
      .orderBy(...orderByFor(query.sort))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
  ]);

  const total = countRows[0]?.value ?? 0;

  const serialized: ProductListRow[] = rows.map((row) => ({
    ...row,
    unitPriceCents: Number(row.unitPriceCents),
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

/**
 * Single product lookup for the edit form and detail surfaces.  Returns
 * null when the product does not exist; callers decide between 404 and
 * domain errors.
 */
export async function getProduct(
  productId: string,
): Promise<ProductListRow | null> {
  const db = getDb();

  const rows = await db
    .select({
      id: products.id,
      categoryId: products.categoryId,
      categoryName: categories.name,
      sku: products.sku,
      name: products.name,
      description: products.description,
      unitPriceCents: products.unitPriceCents,
      stockOnHand: products.stockOnHand,
      reorderLevel: products.reorderLevel,
      isActive: products.isActive,
      createdAt: products.createdAt,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(eq(products.id, productId))
    .limit(1);

  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    ...row,
    unitPriceCents: Number(row.unitPriceCents),
    createdAt: row.createdAt.toISOString(),
  };
}
