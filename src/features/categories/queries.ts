import "server-only";

import { and, asc, count, desc, eq, ilike, sql, type SQL } from "drizzle-orm";

import { getDb } from "@/db";
import { categories, products } from "@/db/schema";
import { ilikeContainsPattern } from "@/lib/list-query/escape";

import type {
  CategoryListPage,
  CategoryListRow,
  ListCategoriesQuery,
} from "./schemas";

/**
 * Paginated category directory with active-product projections.
 *
 * One joined page query (left join on products so empty categories survive)
 * plus a parallel total count sharing the same filter predicate.
 */

const activeProductCount = sql<number>`count(distinct ${products.id})::int`;

function buildConditions(query: ListCategoriesQuery): SQL | undefined {
  const conditions: SQL[] = [];

  if (query.status === "active") {
    conditions.push(eq(categories.isActive, true));
  } else if (query.status === "archived") {
    conditions.push(eq(categories.isActive, false));
  }

  if (query.search !== undefined) {
    conditions.push(ilike(categories.name, ilikeContainsPattern(query.search)));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

function orderByFor(
  sort: ListCategoriesQuery["sort"],
  hasJoin: boolean,
): SQL[] {
  switch (sort) {
    case "name_desc":
      return [desc(sql`lower(${categories.name})`)];
    case "newest":
      return [desc(categories.createdAt)];
    case "most_products":
      // Aggregate ordering is only valid against the joined page query; the
      // count query never sorts.
      return hasJoin
        ? [desc(activeProductCount), asc(sql`lower(${categories.name})`)]
        : [];
    case "name":
    default:
      return [asc(sql`lower(${categories.name})`)];
  }
}

export async function listCategories(
  query: ListCategoriesQuery,
): Promise<CategoryListPage> {
  const db = getDb();
  const where = buildConditions(query);

  const [countRows, rows] = await Promise.all([
    db.select({ value: count() }).from(categories).where(where),
    db
      .select({
        id: categories.id,
        name: categories.name,
        slug: categories.slug,
        description: categories.description,
        isActive: categories.isActive,
        createdAt: categories.createdAt,
        activeProductCount,
      })
      .from(categories)
      .leftJoin(
        products,
        and(
          eq(products.categoryId, categories.id),
          eq(products.isActive, true),
        ),
      )
      .where(where)
      .groupBy(categories.id)
      .orderBy(...orderByFor(query.sort, true))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
  ]);

  const total = countRows[0]?.value ?? 0;

  const serialized: CategoryListRow[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    isActive: row.isActive,
    activeProductCount: row.activeProductCount,
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
