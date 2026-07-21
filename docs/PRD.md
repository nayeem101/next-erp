# NextERP Product Requirements

## Product summary

NextERP is a focused, production-quality ERP vertical for sales fulfillment. It connects customer management, product inventory, sales orders, invoicing, a minimal accounting ledger, and auditability in one coherent workflow.

The project is a portfolio application intended to demonstrate senior-level Next.js 16 and React engineering: deliberate Server/Client Component boundaries, secure mutations, transactional cross-module behavior, accessible enterprise UI, meaningful tests, and a deployable end-to-end result. It is not intended to match the breadth of a commercial ERP.

## Problem statement

Generic CRUD portfolio projects do not prove that a developer can model enterprise workflows, preserve invariants across modules, or make sound rendering and state-management choices. NextERP must demonstrate those abilities through one realistic business flow:

1. Maintain customers and products.
2. Receive and adjust inventory.
3. Build a multi-line sales order.
4. Confirm the order atomically.
5. Deduct stock, issue an invoice, post balanced ledger entries, and record an audit event.
6. Fulfill or cancel the order under explicit lifecycle rules.
7. Surface operational and sales information on a streamed dashboard.

The application must make failure behavior visible and safe. Concurrent order confirmation must never oversell stock, partial confirmation must never leave cross-module data out of sync, and unauthorized UI access must not imply mutation authority.

## Personas

### Admin

- Needs full visibility across sales, inventory, invoices, ledger entries, users, and audit history.
- Assigns application roles to existing users.
- Maintains master data and can perform every operational action.
- Investigates who changed business data and when.

### Sales

- Maintains customers.
- Browses active products and current availability.
- Creates and edits draft orders, confirms orders, and cancels eligible orders.
- Views order history and generated invoices.
- Cannot adjust stock, fulfill orders, assign roles, inspect the ledger, or view the audit log.

### Inventory

- Maintains categories and products.
- Performs reasoned stock adjustments and reviews movement history.
- Views confirmed orders and marks them fulfilled.
- Can see customer identity and shipping/contact details only in the context of an order.
- Cannot create or confirm sales orders, view revenue/ledger data, assign roles, or view the audit log.

## Goals

- Deliver every MVP module as a coherent, deployed workflow.
- Use Next.js 16.x App Router and React 19.2+; no Pages Router or deprecated `middleware.ts` convention.
- Use React Server Components for server-owned reads and Client Components only where browser interactivity requires them.
- Use Server Actions as the mutation boundary, with shared Zod schemas and action-level authorization.
- Preserve stock, invoice, ledger, order, and audit invariants in database transactions.
- Provide enterprise-grade data grids with sorting, filtering, pagination, and column visibility.
- Demonstrate route-, layout-, and action-level RBAC.
- Stream dashboard widgets independently with Suspense so one slow aggregate does not block the page.
- Include focused unit, component, integration, and critical-path browser tests.
- Be usable with keyboard navigation and understandable loading, empty, validation, conflict, and error states.
- Run on Vercel and Supabase free tiers with reproducible local setup and seeded demo data.

## Non-goals

- Multi-company tenancy, subsidiaries, warehouses, bins, lots, serial numbers, or units of measure.
- Purchasing, suppliers, procurement, manufacturing, returns, refunds, credit notes, taxes, discounts, promotions, or payment processing.
- Full general ledger, chart-of-accounts management, reconciliation, fiscal periods, or financial statements.
- Partial shipment, partial fulfillment, backorders, or split invoices.
- Multi-currency or locale-specific tax compliance. MVP uses one configured currency, USD.
- Public customer signup, customer portal, self-service checkout, or public APIs.
- Offline-first behavior or native mobile applications.
- User invitation and password administration inside NextERP. Demo users are provisioned through Supabase; Admin assigns application roles to those users.
- Persisting generated invoice PDFs. MVP streams a deterministic PDF on demand; Supabase Storage is reserved for future persisted assets.
- Realtime updates, email delivery, CSV import, command palette, and optimistic order UI until stretch scope is explicitly approved.

## MVP capabilities and acceptance criteria

### Authentication and RBAC

- Supabase Auth email/password login and logout work in local and deployed environments.
- Unauthenticated users are redirected to `/login` from protected routes.
- Navigation and page access reflect the user's roles.
- Every mutation independently verifies the authenticated user and required role.
- Admin can enable/disable an application user and assign one or more of `admin`, `sales`, and `inventory`.

### Inventory

- Admin and Inventory users can create, edit, and archive categories and products.
- Products have a unique SKU, price in integer cents, reorder level, active state, and non-negative integer stock on hand.
- Stock changes occur only through stock movements or transactional order operations.
- Manual adjustments require a non-zero quantity delta and a reason.
- Low stock means an active product whose `stock_on_hand <= reorder_level`.
- Movement history shows actor, type, quantity delta, resulting balance, reason/reference, and timestamp.

### Customers

- Admin and Sales users can create, edit, archive, search, filter, and inspect customers.
- Customer email is unique case-insensitively among all records.
- Customer detail shows contact data and order history.
- Historical orders retain their customer relationship and remain viewable after customer archival.

### Sales orders

- Admin and Sales users complete a customer → line items → review → confirm wizard.
- A draft can be saved and edited without changing stock.
- Each line uses a unique product, positive integer quantity, and a unit-price snapshot.
- Confirmation atomically verifies stock, deducts it, writes stock movements, creates an invoice, posts ledger entries, updates status, and appends audit records.
- Allowed transitions are `draft → confirmed`, `draft → cancelled`, `confirmed → fulfilled`, and `confirmed → cancelled`. Fulfilled and cancelled orders are terminal.
- Cancelling a confirmed order atomically restores stock, voids the invoice, and posts reversing ledger entries. Cancelling a draft has no financial or inventory side effects.
- Concurrent confirmations cannot produce negative stock.

### Invoicing

- Exactly one invoice is generated for each confirmed order.
- Invoice and order totals equal the sum of immutable line snapshots.
- Authorized users can view an invoice and download a deterministic PDF.
- A cancelled confirmed order retains its invoice for history with status `void`.

### Minimal accounting ledger

- Each confirmed sale creates a balanced journal consisting of an Accounts Receivable debit and Sales Revenue credit.
- Each cancelled confirmed sale creates a separate balanced reversal journal.
- Ledger postings are append-only and visible only to Admin.
- Money is stored as integer cents; floating-point arithmetic is not used for business values.

### Dashboard

- Authenticated users receive role-appropriate widgets.
- Revenue over time, top products, low-stock products, and recent orders render behind independent Suspense boundaries.
- One failed widget displays a local error state without taking down the entire dashboard.

### Audit log

- Security-sensitive and business mutations append actor, action, entity, entity ID, timestamp, and structured before/after metadata.
- Audit rows cannot be updated or deleted through the application.
- Only Admin can view the searchable audit grid.

## Business assumptions

- The MVP represents one company and one logical warehouse.
- USD is the single configured currency and amounts are stored in cents.
- Product unit prices are strictly positive in MVP; free items, discounts, and zero-value invoices are out of scope.
- Seller identity (legal name, address, and contact email) comes from validated server environment configuration and is snapshotted onto each invoice at confirmation.
- Product and customer records are archived rather than physically deleted once referenced.
- Order numbers and invoice numbers are database-generated, human-readable, and immutable.
- Product prices or names may change, but existing order lines and invoices retain their captured unit prices, SKU, and product name.
- No tax or discount is applied, so order subtotal, total, and invoice total are equal.
- Confirmed orders reserve by immediate deduction; there is no separate reservation state.
- Only confirmed orders can be fulfilled. Fulfillment does not create additional stock or accounting entries.
- Revenue-over-time is net Sales Revenue ledger activity by posting date: credits from confirmations minus debits from cancellation reversals. Customer lifetime sales includes only currently confirmed/fulfilled orders. Top products uses net units (`sale` minus `sale_reversal`) in the selected period.
- Role assignments are many-to-many so demo users can exercise combined responsibilities.
- Supabase-created identities are mirrored into `public.users` without roles; an Admin must assign at least one role before application access is granted.
- All timestamps are stored in UTC and displayed in the user's browser locale.

## Portfolio success criteria

The project is successful when:

- A reviewer can complete this scripted demo in under two minutes:
  1. Sign in as Sales.
  2. Create a customer or select an existing one.
  3. Build and confirm a multi-line order.
  4. Observe the generated invoice and download its PDF.
  5. See updated product stock and dashboard data.
  6. Sign in as Admin and show balanced ledger postings plus the audit trail.
- The deployed seed data provides meaningful tables and charts without setup by the reviewer.
- CI runs lint, formatting checks, TypeScript checks, unit/component tests, and critical Playwright tests.
- The order-confirmation integration tests prove atomic stock, invoice, ledger, and audit behavior, including insufficient-stock and concurrent-confirmation cases.
- No privileged secret reaches the browser bundle, and unauthorized mutation tests pass.
- Lighthouse and accessibility checks find no critical issues in the login, dashboard, order wizard, and invoice paths.
- Documentation explains the important trade-offs and matches the implementation.
- The repository has focused commits and a concise README with architecture, setup, test, deployment, and demo instructions.

## Release boundaries

### MVP

All capabilities in this document, through Audit Log, are required before the project is considered complete.

### Optional stretch scope

These are deliberately excluded from MVP and may begin only after explicit approval:

- Optimistic order-creation feedback using `useOptimistic`.
- Supabase Realtime stock updates.
- Order confirmation email through Resend or a similar provider.
- Global `cmd+k` navigation/search command palette.
- CSV product import with validation and an error report.

