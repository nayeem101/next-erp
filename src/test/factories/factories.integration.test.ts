import { beforeAll, describe, expect, test } from "vitest";

import {
  destroyTestDatabase,
  fixedDate,
  initializeTestDatabase,
  withRolledBackTransaction,
} from "@/test/factories/db";
import {
  addOrderLine,
  assignRole,
  cancelOrder,
  confirmOrder,
  createAuthUser,
  createCategory,
  createCustomer,
  createDraftOrder,
  createProduct,
  fulfillOrder,
  getRoleId,
} from "@/test/factories/factories";

import type postgres from "postgres";

const d =
  (process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL)
    ? describe
    : describe.skip;

let sql: postgres.Sql;

beforeAll(async () => {
  sql = await initializeTestDatabase();

  return async () => {
    await destroyTestDatabase();
  };
});

d("deterministic test factories", () => {
  test("provisions identities through the sync trigger with overrides", async () => {
    const user = await createAuthUser({
      displayName: "Ada Lovelace",
    });

    expect(user.displayName).toBe("Ada Lovelace");
    expect(user.isActive).toBe(true);
    expect(user.email).toContain("@example.com");
  });

  test("resolves seeded role ids and assigns memberships idempotently", async () => {
    await withRolledBackTransaction(async (tx) => {
      // Fixed role rows mirror the Phase 1 seed; inserted transactionally so
      // this suite does not depend on seed execution order.
      await tx`
        insert into public.roles (key, name, description) values
          ('admin', 'Administrator', 'Full system access'),
          ('sales', 'Sales', 'Customers, orders, and invoices'),
          ('inventory', 'Inventory', 'Catalog and stock management')
        on conflict (key) do nothing
      `;

      const adminRoleId = await getRoleId("admin", tx);
      const user = await createAuthUser({}, tx);

      await assignRole(user.id, "admin", undefined, tx);
      await assignRole(user.id, "admin", undefined, tx);

      const rows = (await tx`
        select count(*) as n from public.user_roles where user_id = ${user.id}::uuid
      `) as { n: number | string }[];

      expect(Number(rows[0]?.n)).toBe(1);
      expect(adminRoleId).toBeDefined();
    });
  });

  test("creates catalog and customer records with explicit overrides", async () => {
    await withRolledBackTransaction(async (tx) => {
      const admin = await createAuthUser({}, tx);
      const category = await createCategory(admin.id, { name: "Widgets" }, tx);

      const product = await createProduct(
        admin.id,
        category.id,
        { unitPriceCents: 2500, stockOnHand: 7, reorderLevel: 3 },
        tx,
      );

      const customer = await createCustomer(
        admin.id,
        { name: "Acme Corp" },
        tx,
      );

      expect(product.unitPriceCents).toBe(2500);
      expect(product.stockOnHand).toBe(7);
      expect(category.name).toBe("Widgets");
      expect(customer.name).toBe("Acme Corp");
    });
  });

  test("drives the full order lifecycle through helpers", async () => {
    await withRolledBackTransaction(async (tx) => {
      const admin = await createAuthUser({}, tx);
      const category = await createCategory(admin.id, {}, tx);
      const product = await createProduct(admin.id, category.id, {}, tx);
      const customer = await createCustomer(admin.id, {}, tx);

      const order = await createDraftOrder(admin.id, customer.id, tx);
      await addOrderLine(order.id, product, 2, tx);
      await confirmOrder(order.id, admin.id, 2 * product.unitPriceCents, tx);
      await fulfillOrder(order.id, admin.id, tx);

      const rows = (await tx`
        select status from public.orders where id = ${order.id}::uuid
      `) as { status: string }[];

      expect(rows[0]?.status).toBe("fulfilled");

      const cancelledOrder = await createDraftOrder(admin.id, customer.id, tx);

      await cancelOrder(cancelledOrder.id, admin.id, "duplicate request", tx);

      const cancelledRows = (await tx`
        select status from public.orders where id = ${cancelledOrder.id}::uuid
      `) as { status: string }[];

      expect(cancelledRows[0]?.status).toBe("cancelled");
    });
  });

  test("rolls back every write so suites stay order-independent", async () => {
    const before = (await sql`
      select count(*) as n from public.customers
        where email like 'customer-%@example.com'
    `) as { n: number | string }[];

    await withRolledBackTransaction(async (tx) => {
      const admin = await createAuthUser({}, tx);
      await createCustomer(admin.id, {}, tx);
      await createCustomer(admin.id, {}, tx);
    });

    const after = (await sql`
      select count(*) as n from public.customers
        where email like 'customer-%@example.com'
    `) as { n: number | string }[];

    expect(Number(after[0]?.n)).toBe(Number(before[0]?.n));
  });

  test("produces deterministic timestamps from the fixed epoch", () => {
    const base = fixedDate();
    const nextWeek = fixedDate(7);

    expect(base.toISOString()).toBe("2026-01-15T12:00:00.000Z");
    expect(nextWeek.getTime() - base.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
