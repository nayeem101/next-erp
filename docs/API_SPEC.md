# NextERP Server Interface Specification

## Interface principles

- Application mutations use Next.js Server Actions. There is no parallel REST API.
- Actions live in the owning feature, are marked `"use server"`, and accept one explicit input object.
- Inputs are parsed on the server with the same Zod schema used by React Hook Form.
- Authentication and authorization are derived from the server session, never from action input.
- Expected failures are returned as a discriminated `ActionResult`; actions do not throw expected validation, permission, state, or uniqueness errors.
- Unexpected exceptions are logged and returned as `INTERNAL_ERROR`. Only redirects/not-found control flow from Next.js may escape an action.
- Money inputs are decimal strings such as `"149.99"` and are converted to exact cents. Money outputs are cents serialized as strings.
- UUIDs, timestamps, and enum values are serializable strings.

## Shared result and error contract

```ts
export const actionErrorCodeSchema = z.enum([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "CONFLICT",
  "UNIQUE_CONFLICT",
  "INSUFFICIENT_STOCK",
  "LAST_ADMIN",
  "INTERNAL_ERROR",
]);

export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: z.infer<typeof actionErrorCodeSchema>;
        message: string;
        fieldErrors?: Record<string, string[]>;
        correlationId?: string;
        details?: Record<string, unknown>;
      };
    };
```

`details` contains safe, actionable information only. For example, insufficient-stock details contain product ID, SKU, requested quantity, and current availability. SQL messages, stack traces, and secrets are never returned.

## Shared Zod fields

```ts
const idSchema = z.string().uuid();
const requiredText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal(""));
const moneySchema = z
  .string()
  .trim()
  .regex(/^(0|[1-9]\d{0,10})(\.\d{1,2})?$/, "Enter a valid amount");
const positiveMoneySchema = moneySchema.refine(
  (value) => parseMoneyToCents(value) > 0n,
  "Amount must be greater than zero",
);
const quantitySchema = z.coerce.number().int().positive().max(1_000_000);
const nonnegativeQuantitySchema = z.coerce
  .number()
  .int()
  .min(0)
  .max(1_000_000);
const versionSchema = z.coerce.number().int().positive();
const roleKeySchema = z.enum(["admin", "sales", "inventory"]);
```

Input schemas use `.strict()` at their object boundary. Text is trimmed, blank optional values normalize to `undefined`, emails normalize to lowercase, country codes to uppercase, and SKU to uppercase before persistence.

## Permission summary

| Domain/action | Admin | Sales | Inventory |
| --- | :---: | :---: | :---: |
| Login/logout | Yes | Yes | Yes |
| Assign roles / enable users | Yes | No | No |
| Maintain categories/products | Yes | No | Yes |
| Adjust stock | Yes | No | Yes |
| Maintain customers | Yes | Yes | No |
| Create/update drafts and confirm orders | Yes | Yes | No |
| Cancel draft or confirmed (never fulfilled) orders | Yes | Yes | No |
| View operational orders | Yes | Yes | Yes |
| Fulfill confirmed order | Yes | No | Yes |
| View/download invoices | Yes | Yes | No |
| View ledger | Yes | No | No |
| View audit log | Yes | No | No |

Admin and Sales can act on any draft order in this single-company MVP. `created_by` is still retained for accountability.

Action-to-schema mapping:

```text
signIn             → signInSchema
signOut            → no input
setUserRoles       → setUserRolesSchema
setUserActive      → setUserActiveSchema
createCategory     → createCategorySchema
updateCategory     → updateCategorySchema
setCategoryActive  → setCategoryActiveSchema
createProduct      → createProductSchema
updateProduct      → updateProductSchema
setProductActive   → setProductActiveSchema
adjustStock        → adjustStockSchema
createCustomer     → createCustomerSchema
updateCustomer     → updateCustomerSchema
setCustomerActive  → setCustomerActiveSchema
createDraftOrder   → createDraftOrderSchema
updateDraftOrder   → updateDraftOrderSchema
confirmOrder       → transitionOrderSchema
fulfillOrder       → transitionOrderSchema
cancelOrder        → cancelOrderSchema
```

## Authentication actions

### `signIn`

Input:

```ts
const signInSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    password: z.string().min(8).max(128),
    next: z.string().optional(),
  })
  .strict();
```

Roles: Public.

Behavior:

1. Accepts `next` only when it is a same-origin relative path; otherwise uses `/dashboard`.
2. Calls Supabase `signInWithPassword`.
3. Verifies the mapped `public.users` row is active and has at least one role.
4. Updates `last_signed_in_at` and writes `auth.signed_in` audit metadata without credentials.
5. Returns `{ redirectTo: string }`; the client performs navigation.

Errors: `VALIDATION_ERROR`, `UNAUTHENTICATED` (generic invalid credentials), `FORBIDDEN` (inactive or unprovisioned application user), `INTERNAL_ERROR`.

### `signOut`

Input: none.

Roles: Any authenticated user.

Behavior: Calls Supabase sign-out, clears session cookies, and returns `{ redirectTo: "/login" }`.

Errors: `UNAUTHENTICATED` is treated as successful logout; otherwise `INTERNAL_ERROR`.

## User and role actions

### `setUserRoles`

Input:

```ts
const setUserRolesSchema = z
  .object({
    userId: idSchema,
    roles: z.array(roleKeySchema).min(1).max(3),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.roles).size !== value.roles.length) {
      ctx.addIssue({ code: "custom", path: ["roles"], message: "Roles must be unique" });
    }
  });
```

Roles: Admin.

Behavior: In one transaction, locks role administration, replaces the target user's memberships, prevents removal of the last active Admin, increments no auth claims, and appends `user.roles_changed` with before/after role keys. Revalidates `users` and `audit-log`.

Returns: `{ userId, roles }`.

Errors: `UNAUTHENTICATED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `LAST_ADMIN`, `CONFLICT`, `INTERNAL_ERROR`.

### `setUserActive`

Input:

```ts
const setUserActiveSchema = z
  .object({ userId: idSchema, isActive: z.boolean() })
  .strict();
```

Roles: Admin.

Behavior: Enables/disables application access without deleting the Supabase identity. Rejects disabling the last active Admin and self-disable when no other active Admin exists. Appends `user.enabled` or `user.disabled`.

Returns: `{ userId, isActive }`.

Errors: `UNAUTHENTICATED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `LAST_ADMIN`, `CONFLICT`, `INTERNAL_ERROR`.

## Inventory schemas

```ts
const categoryFields = {
  name: requiredText(100),
  description: optionalText(1000),
};

const createCategorySchema = z.object(categoryFields).strict();
const updateCategorySchema = z
  .object({ categoryId: idSchema, ...categoryFields })
  .strict();
const setCategoryActiveSchema = z
  .object({ categoryId: idSchema, isActive: z.boolean() })
  .strict();

const productFields = {
  categoryId: idSchema,
  sku: requiredText(64).transform((value) => value.toUpperCase()),
  name: requiredText(160),
  description: optionalText(2000),
  unitPrice: positiveMoneySchema,
  reorderLevel: nonnegativeQuantitySchema,
};

const createProductSchema = z
  .object({ ...productFields, openingStock: nonnegativeQuantitySchema })
  .strict();
const updateProductSchema = z
  .object({ productId: idSchema, ...productFields })
  .strict();
const setProductActiveSchema = z
  .object({ productId: idSchema, isActive: z.boolean() })
  .strict();
const adjustStockSchema = z
  .object({
    productId: idSchema,
    quantityDelta: z.coerce.number().int().min(-1_000_000).max(1_000_000),
    reason: requiredText(500),
  })
  .strict()
  .refine((value) => value.quantityDelta !== 0, {
    path: ["quantityDelta"],
    message: "Adjustment cannot be zero",
  });
```

### `createCategory`

Roles: Admin, Inventory.

Behavior: Generates a stable slug from the name, creates the category, and appends `category.created`.

Returns: `{ categoryId, slug }`.

Errors: common auth errors, `VALIDATION_ERROR`, `UNIQUE_CONFLICT` for normalized name/slug, `INTERNAL_ERROR`.

### `updateCategory`

Roles: Admin, Inventory.

Behavior: Updates name, derived slug, and description; appends `category.updated` with changed fields.

Returns: `{ categoryId }`.

Errors: common auth errors, `VALIDATION_ERROR`, `NOT_FOUND`, `UNIQUE_CONFLICT`, `CONFLICT`, `INTERNAL_ERROR`.

### `setCategoryActive`

Roles: Admin, Inventory.

Behavior: Archives/restores a category. Archival is rejected while active products belong to it. Appends `category.archived` or `category.restored`.

Returns: `{ categoryId, isActive }`.

Errors: common auth errors, `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`, `INTERNAL_ERROR`.

### `createProduct`

Roles: Admin, Inventory.

Behavior: Verifies an active category, creates the product at zero stock, and, when `openingStock > 0`, atomically updates stock and appends an `opening` movement with reason `Opening balance`. Appends `product.created`.

Returns: `{ productId }`.

Errors: common auth errors, `VALIDATION_ERROR`, `NOT_FOUND` for category, `UNIQUE_CONFLICT` for SKU, `CONFLICT`, `INTERNAL_ERROR`.

### `updateProduct`

Roles: Admin, Inventory.

Behavior: Updates product master data but never stock. Existing order snapshots remain unchanged. Appends `product.updated`.

Returns: `{ productId }`.

Errors: common auth errors, `VALIDATION_ERROR`, `NOT_FOUND`, `UNIQUE_CONFLICT`, `CONFLICT` for inactive category, `INTERNAL_ERROR`.

### `setProductActive`

Roles: Admin, Inventory.

Behavior: Archives/restores a product. Restore requires an active category. Archive does not alter existing drafts; confirmation of a draft containing an archived product is rejected. Appends `product.archived` or `product.restored`.

Returns: `{ productId, isActive }`.

Errors: common auth errors, `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`, `INTERNAL_ERROR`.

### `adjustStock`

Roles: Admin, Inventory.

Behavior: Atomically changes `stock_on_hand`, rejects a negative resulting balance, writes an `adjustment` movement with resulting stock, and appends `product.stock_adjusted`.

Movement sign/reason rules: opening and adjustment deltas use the sign of the stock change; `sale` is negative with reason `Sale for order <orderNumber>`; `sale_reversal` is positive with reason `Cancellation reversal for order <orderNumber>`. System-generated reasons are not accepted from the client.

Returns: `{ productId, stockOnHand }`.

Errors: common auth errors, `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT` for inactive product, `INSUFFICIENT_STOCK` for a negative result, `INTERNAL_ERROR`.

## Customer actions

```ts
const customerFields = {
  name: requiredText(160),
  email: z.string().trim().toLowerCase().email().max(320),
  phone: optionalText(40),
  companyName: optionalText(160),
  addressLine1: requiredText(160),
  addressLine2: optionalText(160),
  city: requiredText(100),
  region: optionalText(100),
  postalCode: requiredText(24),
  countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()),
  notes: optionalText(2000),
};

const createCustomerSchema = z.object(customerFields).strict();
const updateCustomerSchema = z
  .object({ customerId: idSchema, ...customerFields })
  .strict();
const setCustomerActiveSchema = z
  .object({ customerId: idSchema, isActive: z.boolean() })
  .strict();
```

### `createCustomer`

Roles: Admin, Sales.

Behavior: Creates a customer and appends `customer.created`.

Returns: `{ customerId }`.

Errors: common auth errors, `VALIDATION_ERROR`, `UNIQUE_CONFLICT` for email, `INTERNAL_ERROR`.

### `updateCustomer`

Roles: Admin, Sales.

Behavior: Updates contact data and appends `customer.updated` with changed fields.

Returns: `{ customerId }`.

Errors: common auth errors, `VALIDATION_ERROR`, `NOT_FOUND`, `UNIQUE_CONFLICT`, `CONFLICT`, `INTERNAL_ERROR`.

### `setCustomerActive`

Roles: Admin, Sales.

Behavior: Archives/restores a customer. Existing orders remain available; new drafts and confirmation require an active customer. Appends `customer.archived` or `customer.restored`.

Returns: `{ customerId, isActive }`.

Errors: common auth errors, `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`, `INTERNAL_ERROR`.

## Order schemas

```ts
const orderLineInputSchema = z
  .object({
    productId: idSchema,
    quantity: quantitySchema,
  })
  .strict();

const orderDraftFields = {
  customerId: idSchema,
  lines: z.array(orderLineInputSchema).min(1).max(100),
  notes: optionalText(2000),
};

const createDraftOrderSchema = z
  .object(orderDraftFields)
  .strict()
  .superRefine(uniqueProducts);

const updateDraftOrderSchema = z
  .object({
    orderId: idSchema,
    version: versionSchema,
    ...orderDraftFields,
  })
  .strict()
  .superRefine(uniqueProducts);

const transitionOrderSchema = z
  .object({ orderId: idSchema, version: versionSchema })
  .strict();

const cancelOrderSchema = z
  .object({
    orderId: idSchema,
    version: versionSchema,
    reason: requiredText(500),
  })
  .strict();
```

`uniqueProducts` adds a field issue when the same product appears more than once. Client-supplied prices, line totals, status, order number, and actor IDs are not accepted.

### `createDraftOrder`

Roles: Admin, Sales.

Behavior:

1. Verifies active customer and products.
2. Reads current product SKU, name, and price.
3. Computes exact line/total snapshots.
4. Creates draft and lines in one transaction without changing stock.
5. Appends `order.draft_created`.

Returns: `{ orderId, orderNumber, version: 1, totalCents }`.

Errors: common auth errors, `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT` for inactive customer/product, `INTERNAL_ERROR`.

### `updateDraftOrder`

Roles: Admin, Sales.

Behavior: Uses `orderId + version` optimistic concurrency, verifies the order is still draft, refreshes line snapshots from current product data, replaces lines, recomputes total, increments version, and appends `order.draft_updated`.

Returns: `{ orderId, version, totalCents }`.

Errors: common auth errors, `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT` for stale version/non-draft/inactive master data, `INTERNAL_ERROR`.

### `confirmOrder`

Roles: Admin, Sales.

Behavior, in one transaction:

1. Locks the matching draft by ID/version and verifies active customer.
2. Loads lines; rejects an empty order and inactive products.
3. Deducts each product in stable ID order with a conditional non-negative update.
4. Writes one negative `sale` stock movement per line with the fixed order-number reason.
5. Marks the order confirmed, increments version, and sets actor/time.
6. Creates exactly one issued invoice, snapshotting the customer's current bill-to data and validated seller identity configuration.
7. Creates a balanced two-row sale journal: Accounts Receivable debit and Sales Revenue credit.
8. Appends `order.confirmed`, `invoice.issued`, and `ledger.sale_posted`.
9. Commits, then invalidates order, inventory, customer, invoice, ledger, dashboard, and audit caches.

Returns: `{ orderId, orderNumber, version, invoiceId, invoiceNumber, totalCents }`.

Errors: common auth errors, `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT` for stale version/status/inactive data/already invoiced, `INSUFFICIENT_STOCK` with safe per-product details, `INTERNAL_ERROR`.

### `fulfillOrder`

Roles: Admin, Inventory.

Behavior: Uses ID/version concurrency, changes `confirmed → fulfilled`, increments version, records actor/time, and appends `order.fulfilled`. No inventory or ledger entry is created because stock was deducted at confirmation.

Returns: `{ orderId, version, status: "fulfilled" }`.

Errors: common auth errors, `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT` for stale version or invalid status, `INTERNAL_ERROR`.

### `cancelOrder`

Roles: Admin, Sales.

Behavior:

- For a draft: changes it to cancelled, increments version, records reason/actor/time, and appends `order.cancelled`.
- For a confirmed order, in one transaction: restores each line's stock, writes positive `sale_reversal` movements with the fixed order-number reason, voids the invoice, writes a balanced reversal journal, marks the order cancelled, increments version, and appends order/invoice/ledger audit events.
- Fulfilled and cancelled orders cannot be cancelled.

Returns: `{ orderId, version, status: "cancelled", reversed: boolean }`.

Errors: common auth errors, `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT` for stale version/terminal status/missing invoice, `INTERNAL_ERROR`.

## Modules without mutation actions

- Invoices are created and voided only inside order transactions.
- Ledger entries are created only inside order confirm/cancel transactions and are never edited.
- Audit events are written only by domain services and are never edited.
- Dashboard widgets are read-only RSC queries.

This restriction makes illegal cross-module partial states impossible through the public server-action surface.

## Route handlers

### `GET /api/invoices/[invoiceId]/pdf`

Purpose: Binary PDF streaming cannot be returned as a normal Server Action response and benefits from standard download/cache headers.

Runtime: Node.js (`export const runtime = "nodejs"`) because the PDF renderer is not treated as Edge-compatible.

Roles: Admin, Sales.

Path parameter: `invoiceId` must be a UUID.

Behavior:

1. Verifies Supabase user and application role.
2. Loads invoice, order, snapshotted seller/bill-to identity, and immutable line snapshots. It does not use mutable current customer data.
3. Renders the invoice with `@react-pdf/renderer`.
4. Returns a stream with:
   - `Content-Type: application/pdf`
   - `Content-Disposition: attachment; filename="<invoice-number>.pdf"`
   - `Cache-Control: private, no-store`
   - `X-Content-Type-Options: nosniff`

Responses:

- `200` PDF stream.
- `400` invalid UUID.
- `401` unauthenticated.
- `403` authenticated without Admin/Sales.
- `404` missing invoice.
- `500` safe error body with correlation ID; details logged server-side.

Void invoices remain downloadable and render a visible `VOID` marker.

## Read interfaces and URL state

Reads are server-only query functions, not Server Actions or public endpoints. List pages validate `searchParams` with feature schemas. Common parameters:

```ts
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(20),
  sort: z.string().optional(),
  direction: z.enum(["asc", "desc"]).default("asc"),
  q: z.string().trim().max(100).optional(),
});
```

Each page allowlists sortable/filterable columns rather than interpolating arbitrary column names. Invalid parameters fall back to safe defaults and canonical URLs. Query functions return rows plus `{ page, pageSize, totalRows, totalPages }`.

## Audit event names

The fixed event vocabulary is:

```text
auth.signed_in
user.roles_changed
user.enabled
user.disabled
category.created
category.updated
category.archived
category.restored
product.created
product.updated
product.archived
product.restored
product.stock_adjusted
customer.created
customer.updated
customer.archived
customer.restored
order.draft_created
order.draft_updated
order.confirmed
order.fulfilled
order.cancelled
invoice.issued
invoice.voided
ledger.sale_posted
ledger.sale_reversed
```

The fixed `entity_type` vocabulary is `auth_session`, `user`, `category`, `product`, `customer`, `order`, `invoice`, and `ledger_journal`. `entity_id` is the relevant UUID (the journal ID for `ledger_journal`); sign-in events may use the user UUID with `auth_session`.

Sensitive values are excluded. Metadata records IDs, business numbers, changed field names, safe before/after values, totals, reasons, and correlation context.

