# NextERP Database Schema

## Conventions

- PostgreSQL is the source of truth; Drizzle schema and committed migrations describe it.
- Primary keys are UUIDs generated with `gen_random_uuid()`.
- `public.users.id` equals the corresponding Supabase `auth.users.id`.
- Business timestamps are `timestamptz` in UTC.
- Money is `bigint` cents. Application code uses `bigint` internally and serializes amounts as decimal strings across the RSC/client boundary.
- Stock and order quantities are whole units (`integer`); fractional units are outside MVP scope.
- Records referenced by transactions are archived with `is_active = false`, not deleted.
- Human-readable order and invoice numbers use non-cycling PostgreSQL sequences.
- Mutable tables have `created_at` and `updated_at`; append-only tables have only `created_at`.

## Entity relationship diagram

```text
Supabase auth.users
        │ 1:1
        v
users ─────────< user_roles >──────── roles
  │ created/updated/acted by
  │
  ├──────────────────────────────────────────────────────────────┐
  │                                                              │
  v                                                              v
customers 1────────< orders 1────────< order_line_items >────1 products
                        │                         │                 │
                        │                         │                 ├────1 categories
                        │                         │                 │
                        │                         └─────────────────┤
                        │                                          
                        ├────0..1 invoices                          
                        │         │                                
                        ├─────────┴────< ledger_entries            
                        │                                          
                        └──────────────< stock_movements >──── products

users 1────────< audit_log (polymorphic entity_type + entity_id)
```

Relationship notes:

- Users can have multiple roles. Role keys are fixed to Admin, Sales, and Inventory.
- A category has many products; a referenced category cannot be deleted.
- A customer has many orders; archived customers remain referenced.
- An order has one or more line items before confirmation and at most one invoice.
- A product can appear once per order. Order lines retain SKU, name, and unit-price snapshots.
- Confirmed/cancelled orders create stock movements and ledger postings.
- Ledger rows are grouped into balanced journals by `journal_id`.
- Audit log uses a polymorphic entity reference intentionally; no foreign key can cover every entity type.

## Drizzle schema

The definitions below are the intended schema contract. They may be split into files under `src/db/schema/` during implementation.

```ts
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSchema,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const authSchema = pgSchema("auth");

// Read-only declaration for the external Supabase-owned table.
// Drizzle migrations are configured to manage only the public schema.
export const authUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
});

export const roleKey = pgEnum("role_key", [
  "admin",
  "sales",
  "inventory",
]);
export const orderStatus = pgEnum("order_status", [
  "draft",
  "confirmed",
  "fulfilled",
  "cancelled",
]);
export const stockMovementType = pgEnum("stock_movement_type", [
  "opening",
  "adjustment",
  "sale",
  "sale_reversal",
]);
export const invoiceStatus = pgEnum("invoice_status", ["issued", "void"]);
export const ledgerAccount = pgEnum("ledger_account", [
  "accounts_receivable",
  "sales_revenue",
]);
export const ledgerSide = pgEnum("ledger_side", ["debit", "credit"]);
export const journalType = pgEnum("journal_type", [
  "sale",
  "sale_reversal",
]);

export const orderNumberSequence = pgSequence("order_number_seq", {
  startWith: 1000,
});
export const invoiceNumberSequence = pgSequence("invoice_number_seq", {
  startWith: 1000,
});

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    key: roleKey("key").notNull(),
    name: varchar("name", { length: 50 }).notNull(),
    description: text("description").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [unique("roles_key_unique").on(table.key)],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    lastSignedInAt: timestamp("last_signed_in_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.id],
      foreignColumns: [authUsers.id],
      name: "users_auth_user_fk",
    }).onDelete("restrict"),
    uniqueIndex("users_email_lower_unique").on(sql`lower(${table.email})`),
    index("users_active_idx").on(table.isActive),
  ],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    assignedBy: uuid("assigned_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roleId] }),
    index("user_roles_role_id_idx").on(table.roleId),
  ],
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    phone: varchar("phone", { length: 40 }),
    companyName: varchar("company_name", { length: 160 }),
    addressLine1: varchar("address_line_1", { length: 160 }).notNull(),
    addressLine2: varchar("address_line_2", { length: 160 }),
    city: varchar("city", { length: 100 }).notNull(),
    region: varchar("region", { length: 100 }),
    postalCode: varchar("postal_code", { length: 24 }).notNull(),
    countryCode: varchar("country_code", { length: 2 }).notNull(),
    notes: text("notes"),
    isActive: boolean("is_active").default(true).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("customers_email_lower_unique").on(
      sql`lower(${table.email})`,
    ),
    index("customers_name_idx").on(table.name),
    index("customers_active_idx").on(table.isActive),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    slug: varchar("slug", { length: 120 }).notNull(),
    description: text("description"),
    isActive: boolean("is_active").default(true).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("categories_name_lower_unique").on(
      sql`lower(${table.name})`,
    ),
    unique("categories_slug_unique").on(table.slug),
    index("categories_active_idx").on(table.isActive),
  ],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    sku: varchar("sku", { length: 64 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    unitPriceCents: bigint("unit_price_cents", { mode: "bigint" }).notNull(),
    stockOnHand: integer("stock_on_hand").default(0).notNull(),
    reorderLevel: integer("reorder_level").default(0).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("products_sku_upper_unique").on(sql`upper(${table.sku})`),
    index("products_category_id_idx").on(table.categoryId),
    index("products_name_idx").on(table.name),
    index("products_active_idx").on(table.isActive),
    index("products_low_stock_idx")
      .on(table.stockOnHand, table.reorderLevel)
      .where(sql`${table.isActive} = true`),
    check("products_price_positive", sql`${table.unitPriceCents} > 0`),
    check("products_stock_nonnegative", sql`${table.stockOnHand} >= 0`),
    check("products_reorder_level_nonnegative", sql`${table.reorderLevel} >= 0`),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderNumber: varchar("order_number", { length: 24 })
      .default(sql`'SO-' || lpad(nextval('order_number_seq')::text, 6, '0')`)
      .notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    status: orderStatus("status").default("draft").notNull(),
    version: integer("version").default(1).notNull(),
    currencyCode: varchar("currency_code", { length: 3 })
      .default("USD")
      .notNull(),
    totalCents: bigint("total_cents", { mode: "bigint" })
      .default(0n)
      .notNull(),
    notes: text("notes"),
    cancellationReason: text("cancellation_reason"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    confirmedBy: uuid("confirmed_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    fulfilledBy: uuid("fulfilled_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    cancelledBy: uuid("cancelled_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("orders_order_number_unique").on(table.orderNumber),
    index("orders_customer_id_idx").on(table.customerId),
    index("orders_status_created_at_idx").on(table.status, table.createdAt),
    index("orders_created_by_idx").on(table.createdBy),
    check("orders_version_positive", sql`${table.version} > 0`),
    check("orders_total_nonnegative", sql`${table.totalCents} >= 0`),
    check("orders_currency_usd", sql`${table.currencyCode} = 'USD'`),
  ],
);

export const orderLineItems = pgTable(
  "order_line_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    productSku: varchar("product_sku", { length: 64 }).notNull(),
    productName: varchar("product_name", { length: 160 }).notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: bigint("unit_price_cents", { mode: "bigint" }).notNull(),
    lineTotalCents: bigint("line_total_cents", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("order_line_items_order_product_unique").on(
      table.orderId,
      table.productId,
    ),
    index("order_line_items_product_id_idx").on(table.productId),
    check("order_line_items_quantity_positive", sql`${table.quantity} > 0`),
    check(
      "order_line_items_price_nonnegative",
      sql`${table.unitPriceCents} >= 0`,
    ),
    check(
      "order_line_items_total_matches",
      sql`${table.lineTotalCents} = ${table.quantity} * ${table.unitPriceCents}`,
    ),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceNumber: varchar("invoice_number", { length: 24 })
      .default(sql`'INV-' || lpad(nextval('invoice_number_seq')::text, 6, '0')`)
      .notNull(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    status: invoiceStatus("status").default("issued").notNull(),
    currencyCode: varchar("currency_code", { length: 3 })
      .default("USD")
      .notNull(),
    sellerSnapshot: jsonb("seller_snapshot")
      .$type<{
        name: string;
        email: string;
        addressLine1: string;
        addressLine2?: string;
        city: string;
        region?: string;
        postalCode: string;
        countryCode: string;
      }>()
      .notNull(),
    billToSnapshot: jsonb("bill_to_snapshot")
      .$type<{
        name: string;
        email: string;
        companyName?: string;
        phone?: string;
        addressLine1: string;
        addressLine2?: string;
        city: string;
        region?: string;
        postalCode: string;
        countryCode: string;
      }>()
      .notNull(),
    subtotalCents: bigint("subtotal_cents", { mode: "bigint" }).notNull(),
    totalCents: bigint("total_cents", { mode: "bigint" }).notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("invoices_invoice_number_unique").on(table.invoiceNumber),
    unique("invoices_order_id_unique").on(table.orderId),
    index("invoices_status_issued_at_idx").on(table.status, table.issuedAt),
    check("invoices_subtotal_positive", sql`${table.subtotalCents} > 0`),
    check("invoices_total_positive", sql`${table.totalCents} > 0`),
    check(
      "invoices_total_matches_subtotal",
      sql`${table.totalCents} = ${table.subtotalCents}`,
    ),
    check("invoices_currency_usd", sql`${table.currencyCode} = 'USD'`),
    check(
      "invoices_seller_snapshot_shape",
      sql`jsonb_typeof(${table.sellerSnapshot}) = 'object'
        AND ${table.sellerSnapshot} ?& ARRAY[
          'name', 'email', 'addressLine1', 'city', 'postalCode', 'countryCode'
        ]`,
    ),
    check(
      "invoices_bill_to_snapshot_shape",
      sql`jsonb_typeof(${table.billToSnapshot}) = 'object'
        AND ${table.billToSnapshot} ?& ARRAY[
          'name', 'email', 'addressLine1', 'city', 'postalCode', 'countryCode'
        ]`,
    ),
  ],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").references(() => orders.id, {
      onDelete: "restrict",
    }),
    type: stockMovementType("type").notNull(),
    quantityDelta: integer("quantity_delta").notNull(),
    resultingStock: integer("resulting_stock").notNull(),
    reason: varchar("reason", { length: 500 }).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("stock_movements_product_created_at_idx").on(
      table.productId,
      table.createdAt,
    ),
    index("stock_movements_order_id_idx").on(table.orderId),
    check(
      "stock_movements_quantity_nonzero",
      sql`${table.quantityDelta} <> 0`,
    ),
    check(
      "stock_movements_result_nonnegative",
      sql`${table.resultingStock} >= 0`,
    ),
    check(
      "stock_movements_order_reference",
      sql`(
        (${table.type} IN ('sale', 'sale_reversal') AND ${table.orderId} IS NOT NULL)
        OR
        (${table.type} IN ('opening', 'adjustment') AND ${table.orderId} IS NULL)
      )`,
    ),
  ],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    journalId: uuid("journal_id").notNull(),
    journalType: journalType("journal_type").notNull(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    account: ledgerAccount("account").notNull(),
    side: ledgerSide("side").notNull(),
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
    description: varchar("description", { length: 240 }).notNull(),
    postedBy: uuid("posted_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("ledger_entries_journal_id_idx").on(table.journalId),
    index("ledger_entries_order_id_idx").on(table.orderId),
    index("ledger_entries_invoice_id_idx").on(table.invoiceId),
    index("ledger_entries_created_at_idx").on(table.createdAt),
    check("ledger_entries_amount_positive", sql`${table.amountCents} > 0`),
    check(
      "ledger_entries_account_normal_side",
      sql`(
        (${table.journalType} = 'sale'
          AND (
            (${table.account} = 'accounts_receivable' AND ${table.side} = 'debit')
            OR (${table.account} = 'sales_revenue' AND ${table.side} = 'credit')
          ))
        OR
        (${table.journalType} = 'sale_reversal'
          AND (
            (${table.account} = 'accounts_receivable' AND ${table.side} = 'credit')
            OR (${table.account} = 'sales_revenue' AND ${table.side} = 'debit')
          ))
      )`,
    ),
    unique("ledger_entries_journal_account_unique").on(
      table.journalId,
      table.account,
    ),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: varchar("action", { length: 80 }).notNull(),
    entityType: varchar("entity_type", { length: 80 }).notNull(),
    entityId: uuid("entity_id"),
    metadata: jsonb("metadata")
      .$type<{
        before?: Record<string, unknown>;
        after?: Record<string, unknown>;
        reason?: string;
        context?: Record<string, unknown>;
      }>()
      .default({})
      .notNull(),
    correlationId: uuid("correlation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_log_created_at_idx").on(table.createdAt),
    index("audit_log_actor_created_at_idx").on(
      table.actorUserId,
      table.createdAt,
    ),
    index("audit_log_entity_idx").on(table.entityType, table.entityId),
    index("audit_log_action_idx").on(table.action),
  ],
);
```

## Constraints that require migration SQL

Drizzle expresses table-local constraints. The following cross-row/lifecycle constraints are installed with reviewed SQL migrations.

### Updated timestamp trigger

A shared `set_updated_at()` trigger updates `updated_at` for `users`, `customers`, `categories`, `products`, and `orders`. Application-supplied timestamps are not trusted.

### Supabase identity synchronization

A narrowly scoped `SECURITY DEFINER` trigger on `auth.users` inserts a matching `public.users` row after identity creation and synchronizes normalized email/display-name fields after relevant Auth updates. It sets a safe `search_path`, fully qualifies objects, and never assigns a role. A newly provisioned identity therefore cannot enter the application until an Admin assigns at least one role. Integration tests cover malicious metadata, duplicate email, and trigger permissions.

### Order lifecycle trigger

An update trigger permits only:

```text
draft     → draft | confirmed | cancelled
confirmed → confirmed | fulfilled | cancelled
fulfilled → fulfilled
cancelled → cancelled
```

It also checks status timestamps/actors:

- `confirmed` requires `confirmed_at` and `confirmed_by`.
- `fulfilled` requires prior confirmation plus `fulfilled_at` and `fulfilled_by`.
- `cancelled` requires `cancelled_at`, `cancelled_by`, and a nonblank reason.
- Once an order leaves draft, its customer, currency, total, and line items are immutable. A line-item trigger rejects insert/update/delete when its parent order is not `draft`; an order trigger rejects changes to those snapshot-defining fields while status is `confirmed`, `fulfilled`, or `cancelled`.

Application services reject no-op transitions with a typed conflict even though the trigger permits ordinary updates to the same status.

### Balanced journals

A deferred constraint trigger runs at transaction commit for every affected `journal_id`:

```sql
SELECT
  COALESCE(sum(amount_cents) FILTER (WHERE side = 'debit'), 0),
  COALESCE(sum(amount_cents) FILTER (WHERE side = 'credit'), 0),
  count(*)
FROM ledger_entries
WHERE journal_id = NEW.journal_id;
```

The trigger raises a constraint error unless debit equals credit and the journal contains exactly two entries. Because it is deferred, both postings can be inserted in one transaction.

### Append-only records

Database triggers reject `UPDATE` and `DELETE` on:

- `stock_movements`
- `ledger_entries`
- `audit_log`

The application database role is also denied update/delete privileges on those tables. Corrections are new movements, reversal journals, or new audit events.

System movement reasons are deterministic: `Opening balance`, `Sale for order <order_number>`, and `Cancellation reversal for order <order_number>`. A `sale` has a negative delta, a `sale_reversal` has a positive delta, and opening/adjustment deltas use the same sign as their stock change.

### RLS and runtime role

RLS is enabled on all `public` application tables. The dedicated server runtime role has explicit least-privilege policies/grants for the reads and writes used by the application; it does not own tables, alter schema, or bypass RLS. Supabase `anon` and `authenticated` browser roles receive no application-table policies, so direct browser reads and writes are denied. Append-only tables give the runtime role `SELECT`/`INSERT` only. Migration and Auth synchronization functions run under separate privileged ownership.

### Preventing negative stock

The `products_stock_nonnegative` check is the final guard. Confirm-order uses one transaction and updates products in sorted UUID order:

```sql
UPDATE products
SET stock_on_hand = stock_on_hand - $quantity
WHERE id = $product_id
  AND is_active = true
  AND stock_on_hand >= $quantity
RETURNING stock_on_hand;
```

If any update returns no row, the service returns `INSUFFICIENT_STOCK` and rolls back all product updates, movements, invoice, ledger, order, and audit writes. Cancellation locks the same product set and adds quantities back.

### Last Admin protection

Before disabling a user or deleting an Admin membership, the role service locks active Admin memberships and rejects the operation if it would leave zero active Admins. A transaction-scoped advisory lock serializes concurrent role changes.

## Index rationale

- Case-normalized unique indexes enforce user/customer email, category name, and SKU identity independently of application casing.
- Status + timestamp indexes serve operational order and invoice queues.
- Product/category and customer/order indexes serve joins and detail histories.
- Product stock/reorder partial index supports the low-stock widget.
- Movement, ledger, and audit indexes lead with their most common filter and then timestamp for recent-first grids.
- Search uses escaped `ILIKE` over indexed exact/filter columns for the MVP dataset. Full-text/trigram indexes are deferred until profiling proves a need.

## Referential actions

- Supabase auth deletion is restricted once a `public.users` row exists. Accounts are disabled rather than deleted so actor history and foreign keys remain intact.
- User references on business rows use `RESTRICT` to preserve actor history; audit actor uses `SET NULL` as a final safety valve.
- Master data referenced by transactions uses `RESTRICT`.
- Draft order line items cascade when an order is deleted by test/maintenance tooling; the application cancels rather than deletes orders.
- Invoice, ledger, stock movement, and order relationships use `RESTRICT`.

## Seed data

The development/demo seed is idempotent and, once the Phase 5 workflows exist, creates:

- Three immutable role rows.
- One active demo user per role plus one multi-role Admin, mapped to pre-provisioned Supabase Auth IDs supplied through seed environment variables.
- At least four categories, twenty products with varied stock/reorder levels, ten customers, and orders distributed over recent months.
- A mix of draft, confirmed, fulfilled, and cancelled orders created through the same domain services used by the application so invoices, movements, ledger entries, and audit rows are internally consistent. Seed data is added incrementally after each owning service exists: base roles/users in Phase 1, inventory in Phase 2, customers in Phase 3, and transactional orders in Phase 5.

No production password, access token, or service-role key is committed.

