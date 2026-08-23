import { getSharedSql, type Queryable } from "@/test/factories/db";

export interface AuthUserRecord {
  id: string;
  email: string;
}

export interface AppUserRecord extends AuthUserRecord {
  displayName: string;
  isActive: boolean;
}

export interface CategoryRecord {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
}

export interface ProductRecord {
  id: string;
  categoryId: string;
  sku: string;
  name: string;
  unitPriceCents: number;
  stockOnHand: number;
  reorderLevel: number;
  isActive: boolean;
}

export interface CustomerRecord {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
}

export interface OrderRecord {
  id: string;
  orderNumber: string;
  customerId: string;
  status: string;
  version: number;
  totalCents: number;
}

function db(handle?: Queryable): Queryable {
  return handle ?? getSharedSql();
}

/** Inserts an auth identity; the sync trigger provisions public.users. */
export async function createAuthUser(
  overrides: Partial<AuthUserRecord> & { displayName?: string } = {},
  handle?: Queryable,
): Promise<AppUserRecord> {
  const id = overrides.id ?? crypto.randomUUID();
  const email = overrides.email ?? `user-${id.slice(0, 8)}@example.com`;
  const metadata =
    overrides.displayName === undefined
      ? {}
      : { display_name: overrides.displayName };

  await db(handle)`
    insert into auth.users (id, email, raw_user_meta_data)
    values (${id}::uuid, ${email}, ${db(handle).json(metadata)})
  `;

  const rows = (await db(handle)`
    select email, display_name as "displayName", is_active as "isActive"
    from public.users where id = ${id}::uuid
  `) as { email: string; displayName: string; isActive: boolean }[];

  const row = rows[0];

  if (!row) {
    throw new Error("identity synchronization did not provision the user");
  }

  return {
    id,
    email: row.email,
    displayName: row.displayName,
    isActive: row.isActive,
  };
}

export async function getRoleId(
  key: "admin" | "sales" | "inventory",
  handle?: Queryable,
): Promise<string> {
  const rows = (await db(handle)`
    select id from public.roles where key = ${key}
  `) as { id: string }[];

  const id = rows[0]?.id;

  if (!id) {
    throw new Error(`role "${key}" is missing; run the seed first`);
  }

  return id;
}

export async function assignRole(
  userId: string,
  roleKey: "admin" | "sales" | "inventory",
  assignedBy?: string,
  handle?: Queryable,
): Promise<void> {
  const roleId = await getRoleId(roleKey, handle);

  await db(handle)`
    insert into public.user_roles (user_id, role_id, assigned_by)
    values (${userId}::uuid, ${roleId}::uuid, ${assignedBy ?? null}::uuid)
    on conflict do nothing
  `;
}

export async function createCategory(
  createdByUserId: string,
  overrides: Partial<CategoryRecord> = {},
  handle?: Queryable,
): Promise<CategoryRecord> {
  const name = overrides.name ?? `Category ${crypto.randomUUID().slice(0, 10)}`;
  const slug = overrides.slug ?? `cat-${crypto.randomUUID().slice(0, 12)}`;

  await db(handle)`
    insert into public.categories (name, slug, created_by, updated_by)
    values (${name}, ${slug}, ${createdByUserId}::uuid, ${createdByUserId}::uuid)
  `;

  const rows = (await db(handle)`
    select id from public.categories where name = ${name}
  `) as { id: string }[];

  const id = rows[0]?.id;

  if (!id) {
    throw new Error("category insert failed");
  }

  return { id, name, slug, isActive: true };
}

export async function createProduct(
  createdByUserId: string,
  categoryId: string,
  overrides: Partial<ProductRecord> = {},
  handle?: Queryable,
): Promise<ProductRecord> {
  const sku = overrides.sku ?? `SKU-${crypto.randomUUID().slice(0, 10)}`;
  const record: ProductRecord = {
    id: "",
    categoryId,
    sku,
    name: overrides.name ?? `Product ${sku}`,
    unitPriceCents: overrides.unitPriceCents ?? 1999,
    stockOnHand: overrides.stockOnHand ?? 100,
    reorderLevel: overrides.reorderLevel ?? 10,
    isActive: true,
  };

  await db(handle)`
    insert into public.products (
      category_id, sku, name, unit_price_cents,
      stock_on_hand, reorder_level, created_by, updated_by
    )
    values (
      ${categoryId}::uuid, ${record.sku}, ${record.name}, ${record.unitPriceCents},
      ${record.stockOnHand}, ${record.reorderLevel},
      ${createdByUserId}::uuid, ${createdByUserId}::uuid
    )
  `;

  const rows = (await db(handle)`
    select id from public.products where sku = ${record.sku}
  `) as { id: string }[];

  record.id = rows[0]?.id ?? "";

  if (!record.id) {
    throw new Error("product insert failed");
  }

  return record;
}

export async function createCustomer(
  createdByUserId: string,
  overrides: Partial<CustomerRecord> = {},
  handle?: Queryable,
): Promise<CustomerRecord> {
  const email =
    overrides.email ??
    `customer-${crypto.randomUUID().slice(0, 10)}@example.com`;
  const name = overrides.name ?? `Customer ${crypto.randomUUID().slice(0, 8)}`;

  await db(handle)`
    insert into public.customers (
      name, email, address_line_1, city, postal_code, country_code,
      created_by, updated_by
    )
    values (
      ${name}, ${email}, '1 Main Street', 'Springfield', '12345', 'US',
      ${createdByUserId}::uuid, ${createdByUserId}::uuid
    )
  `;

  const rows = (await db(handle)`
    select id from public.customers where email = ${email}
  `) as { id: string }[];

  const id = rows[0]?.id;

  if (!id) {
    throw new Error("customer insert failed");
  }

  return { id, name, email, isActive: true };
}

export async function createDraftOrder(
  createdByUserId: string,
  customerId: string,
  handle?: Queryable,
): Promise<OrderRecord> {
  const rows = (await db(handle)`
    insert into public.orders (customer_id, created_by, updated_by)
    values (${customerId}::uuid, ${createdByUserId}::uuid, ${createdByUserId}::uuid)
    returning id, order_number as "orderNumber", customer_id as "customerId",
              status, version, total_cents::int as "totalCents"
  `) as OrderRecord[];

  const row = rows[0];

  if (!row) {
    throw new Error("order insert failed");
  }

  return row;
}

export async function addOrderLine(
  orderId: string,
  product: ProductRecord,
  quantity: number,
  handle?: Queryable,
): Promise<void> {
  await db(handle)`
    insert into public.order_line_items (
      order_id, product_id, product_sku, product_name,
      quantity, unit_price_cents, line_total_cents
    )
    values (
      ${orderId}::uuid, ${product.id}::uuid, ${product.sku}, ${product.name},
      ${quantity}, ${product.unitPriceCents}, ${quantity * product.unitPriceCents}
    )
  `;
}

export async function confirmOrder(
  orderId: string,
  confirmedBy: string,
  totalCents: number,
  handle?: Queryable,
): Promise<void> {
  await db(handle)`
    update public.orders
    set status = 'confirmed', confirmed_by = ${confirmedBy}::uuid,
        confirmed_at = now(), total_cents = ${totalCents}
    where id = ${orderId}::uuid
  `;
}

export async function fulfillOrder(
  orderId: string,
  fulfilledBy: string,
  handle?: Queryable,
): Promise<void> {
  await db(handle)`
    update public.orders
    set status = 'fulfilled', fulfilled_by = ${fulfilledBy}::uuid, fulfilled_at = now()
    where id = ${orderId}::uuid
  `;
}

export async function cancelOrder(
  orderId: string,
  cancelledBy: string,
  reason: string,
  handle?: Queryable,
): Promise<void> {
  await db(handle)`
    update public.orders
    set status = 'cancelled', cancelled_by = ${cancelledBy}::uuid,
        cancelled_at = now(), cancellation_reason = ${reason}
    where id = ${orderId}::uuid
  `;
}
