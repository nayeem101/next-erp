import "server-only";

import { asc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { customers, products } from "@/db/schema";

/**
 * Wizard selector reads.
 *
 * These expose the minimum serialized fields the order wizard needs: an
 * identity label plus, for products, price and availability context. No
 * financial or audit fields leak through these projections.
 */

export interface ActiveCustomerOption {
  id: string;
  name: string;
  companyName: string | null;
  email: string;
  phone: string | null;
  city: string;
  region: string | null;
  countryCode: string;
}

export interface ActiveProductOption {
  id: string;
  sku: string;
  name: string;
  unitPriceCents: number;
  stockOnHand: number;
}

export async function listActiveCustomerOptions(): Promise<
  ActiveCustomerOption[]
> {
  const db = getDb();

  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      companyName: customers.companyName,
      email: customers.email,
      phone: customers.phone,
      city: customers.city,
      region: customers.region,
      countryCode: customers.countryCode,
    })
    .from(customers)
    .where(eq(customers.isActive, true))
    .orderBy(asc(customers.name));

  return rows;
}

export async function listActiveProductOptions(): Promise<
  ActiveProductOption[]
> {
  const db = getDb();

  const rows = await db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      unitPriceCents: products.unitPriceCents,
      stockOnHand: products.stockOnHand,
    })
    .from(products)
    .where(eq(products.isActive, true))
    .orderBy(asc(products.name));

  return rows.map((row) => ({
    ...row,
    unitPriceCents: Number(row.unitPriceCents),
  }));
}
