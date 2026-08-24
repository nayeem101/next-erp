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
import { customers, orders } from "@/db/schema";
import { ilikeContainsPattern } from "@/lib/list-query/escape";

import {
  listCustomersQuerySchema,
  listCustomerOrdersQuerySchema,
} from "./schemas";

import type {
  CustomerDetailRow,
  CustomerListPage,
  CustomerListRow,
  CustomerOrderPage,
  CustomerOrderRow,
  ListCustomerOrdersQuery,
  ListCustomerOrdersQueryInput,
  ListCustomersQuery,
  ListCustomersQueryInput,
} from "./schemas";

/**
 * Paginated customer directory with per-customer order projections.
 *
 * `orderCount` covers every order regardless of status; `confirmedSales`
 * sums totals of confirmed and fulfilled orders only. Filters: escaped
 * text search across name/email/company, lifecycle status.
 */

function buildConditions(query: ListCustomersQuery): SQL | undefined {
  const conditions: SQL[] = [];

  if (query.status === "active") {
    conditions.push(eq(customers.isActive, true));
  } else if (query.status === "archived") {
    conditions.push(eq(customers.isActive, false));
  }

  if (query.search !== undefined) {
    const pattern = ilikeContainsPattern(query.search);

    const searchable = or(
      ilike(customers.name, pattern),
      ilike(customers.email, pattern),
      ilike(customers.companyName, pattern),
    );

    if (searchable) {
      conditions.push(searchable);
    }
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

function orderByFor(sort: ListCustomersQuery["sort"]): SQL[] {
  switch (sort) {
    case "name_desc":
      return [desc(sql`lower(${customers.name})`)];
    case "email":
      return [asc(sql`lower(${customers.email})`)];
    case "email_desc":
      return [desc(sql`lower(${customers.email})`)];
    case "newest":
      return [desc(customers.createdAt), asc(sql`lower(${customers.name})`)];
    case "name":
    default:
      return [asc(sql`lower(${customers.name})`)];
  }
}

/**
 * Correlated order aggregates.
 *
 * Written with fully qualified table/column names: drizzle renders bare
 * column identifiers inside raw `sql` templates, which inside a subquery
 * would bind to the inner table instead of the outer `customers` row.
 */
const baseSelection = {
  id: customers.id,
  name: customers.name,
  email: customers.email,
  phone: customers.phone,
  companyName: customers.companyName,
  city: customers.city,
  region: customers.region,
  countryCode: customers.countryCode,
  isActive: customers.isActive,
  createdAt: customers.createdAt,
  // Declared string: postgres.js returns bigint aggregates as strings.
  orderCount:
    sql<string>`(select count(*) from public.orders o where o.customer_id = public.customers.id)`.as(
      "orderCount",
    ),
  confirmedSalesCents:
    sql<string>`(select coalesce(sum(o.total_cents), 0) from public.orders o where o.customer_id = public.customers.id and o.status in ('confirmed', 'fulfilled'))`.as(
      "confirmedSalesCents",
    ),
};

export async function listCustomers(
  rawQuery: ListCustomersQueryInput,
): Promise<CustomerListPage> {
  const query: ListCustomersQuery = listCustomersQuerySchema.parse(rawQuery);
  const db = getDb();
  const where = buildConditions(query);

  const [countRows, rows] = await Promise.all([
    db.select({ value: count() }).from(customers).where(where),
    db
      .select(baseSelection)
      .from(customers)
      .where(where)
      .orderBy(...orderByFor(query.sort))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
  ]);

  const total = countRows[0]?.value ?? 0;

  const serialized: CustomerListRow[] = rows.map((row) => ({
    ...row,
    orderCount: Number(row.orderCount),
    confirmedSalesCents: Number(row.confirmedSalesCents),
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
 * Full customer record for the detail page and edit form, enriched with
 * order KPIs (open drafts, recognized sales, last order timestamp).
 */
export async function getCustomer(
  customerId: string,
): Promise<CustomerDetailRow | null> {
  const db = getDb();

  const rows = await db
    .select({
      ...baseSelection,
      addressLine1: customers.addressLine1,
      addressLine2: customers.addressLine2,
      postalCode: customers.postalCode,
      notes: customers.notes,
      openDraftCount:
        sql<string>`(select count(*) from public.orders o where o.customer_id = public.customers.id and o.status = 'draft')`.as(
          "openDraftCount",
        ),
      // Scalar subqueries surface as raw timestamp strings.
      lastOrderAt: sql<
        string | null
      >`(select max(o.created_at) from public.orders o where o.customer_id = public.customers.id)`.as(
        "lastOrderAt",
      ),
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    ...row,
    orderCount: Number(row.orderCount),
    openDraftCount: Number(row.openDraftCount),
    confirmedSalesCents: Number(row.confirmedSalesCents),
    createdAt: row.createdAt.toISOString(),
    lastOrderAt: row.lastOrderAt
      ? new Date(row.lastOrderAt).toISOString()
      : null,
  };
}

/**
 * Paginated order history for one customer, newest first by default.
 */
export async function listCustomerOrders(
  customerId: string,
  rawQuery: ListCustomerOrdersQueryInput = {},
): Promise<CustomerOrderPage> {
  const query: ListCustomerOrdersQuery =
    listCustomerOrdersQuerySchema.parse(rawQuery);
  const db = getDb();
  const scope = eq(orders.customerId, customerId);

  const conditions: SQL[] = [scope];

  if (query.status !== "all") {
    conditions.push(eq(orders.status, query.status));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  function orderByFor(sort: ListCustomerOrdersQuery["sort"]): SQL[] {
    switch (sort) {
      case "oldest":
        return [asc(orders.createdAt)];
      case "total_asc":
        return [asc(orders.totalCents), desc(orders.createdAt)];
      case "total_desc":
        return [desc(orders.totalCents), desc(orders.createdAt)];
      case "newest":
      default:
        return [desc(orders.createdAt)];
    }
  }

  const [countRows, rows] = await Promise.all([
    db.select({ value: count() }).from(orders).where(where),
    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        version: orders.version,
        totalCents: orders.totalCents,
        currencyCode: orders.currencyCode,
        createdAt: orders.createdAt,
        confirmedAt: orders.confirmedAt,
      })
      .from(orders)
      .where(where)
      .orderBy(...orderByFor(query.sort))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
  ]);

  const total = countRows[0]?.value ?? 0;

  const serialized: CustomerOrderRow[] = rows.map((row) => ({
    ...row,
    totalCents: Number(row.totalCents),
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
