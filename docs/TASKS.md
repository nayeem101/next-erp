# NextERP Build Plan

## How to use this plan

- Work top to bottom because tasks are dependency-ordered.
- One checklist item is one focused work session and normally one commit.
- Before implementation, confirm the task still matches the other specification documents.
- A task is complete only when its required tests pass and no new lint/type errors remain.
- After each completed task, update `docs/PROJECT_PROGRESS.md` with current/next task and verification evidence.
- Run the phase gate before starting the next phase.
- Do not start Phase 8 until every MVP item is complete and stretch work is explicitly approved.

## Phase 0 — Specification

- [x] Write product requirements and explicit MVP/non-goal boundaries.
- [x] Document rendering, data flow, auth/RBAC, routing, transaction, and caching architecture.
- [x] Specify the complete ERD, Drizzle tables, indexes, constraints, and database invariants.
- [x] Specify every Server Action, input schema, permission, result, and route handler.
- [x] Specify every page, Server/Client boundary, reusable component, and UI state.
- [x] Define code organization, action errors, validation sharing, test policy, and quality gates.
- [x] Produce this dependency-ordered MVP and optional stretch task plan.
- [x] Add compact `.cursor/rules/*.mdc` guidance and document current Cursor project-file conventions.

Approval gate: explicit approval of all seven documents is required before Phase 1.

## Phase 1 — Foundation, database, authentication, and RBAC

### Project scaffold and quality tooling

- [x] Scaffold Next.js 16.x App Router with React 19.2+, Cache Components, strict TypeScript, `src/`, Tailwind, pnpm, Node LTS pin, and import aliases.
- [x] Add and configure shadcn/ui tokens, base typography, responsive shell colors, and core primitives used by login/shell/forms.
- [x] Configure ESLint strict rules, Prettier, import ordering, and package scripts for format/lint/typecheck/build.
- [x] Configure Vitest, React Testing Library, jsdom setup, coverage thresholds, and one passing smoke test.
- [x] Configure Playwright projects, web-server lifecycle, trace-on-retry, and a test-only environment contract.
- [x] Add Husky and lint-staged pre-commit checks for supported staged files.
- [x] Add CI workflow for install, format, lint, typecheck, unit/component tests, integration tests, build, and Playwright.
- [x] Add Zod-validated server/public environment modules, required seller identity fields, and `.env.example` without secrets.
- [ ] Add root `.cursorignore` exclusions for secrets, dependencies, build/test artifacts, lockfile, and generated PDFs.
- [ ] Add security headers, safe redirect helper, request correlation IDs, and structured server logging.

### Supabase and Drizzle

- [ ] Configure browser/server/Proxy Supabase clients with `@supabase/ssr` cookie handling and tests for cookie adaptation.
- [ ] Configure server-only Drizzle with the Supabase pooler, restricted runtime credentials, `prepare: false`, and connection smoke test.
- [ ] Configure Drizzle Kit, public-schema migration output, migration scripts, and disposable integration-test database setup.
- [ ] Create role enums, roles/users/user_roles Drizzle schema and migration, including the external `auth.users` foreign key.
- [ ] Add hardened Supabase Auth identity synchronization trigger with no default role and integration tests for metadata/permission edge cases.
- [ ] Create categories/products Drizzle schema and migration with case-normalized uniqueness, stock/price constraints, and indexes.
- [ ] Create customers Drizzle schema and migration with normalized email uniqueness and indexes.
- [ ] Create orders/order_line_items Drizzle schema and migration with sequence, snapshots, versions, totals, and indexes.
- [ ] Create invoices Drizzle schema and migration with sequence, seller/bill-to snapshots, one-invoice-per-order, amount/status constraints, and indexes.
- [ ] Create stock_movements Drizzle schema and migration with reference/type checks and indexes.
- [ ] Create ledger_entries Drizzle schema and migration with account/side rules, journal uniqueness, and indexes.
- [ ] Create audit_log Drizzle schema and migration with structured metadata and query indexes.
- [ ] Add migration SQL for `updated_at`, legal order transitions, immutable order/customer/total/lines after confirmation, balanced deferred journals, and append-only tables.
- [ ] Add RLS enablement, no-browser-access policies, least-privilege non-owner runtime policies/grants, and migration tests for denied/append-only operations.
- [ ] Add inferred Drizzle relations and schema barrel exports without crossing server/client boundaries.
- [ ] Implement deterministic test factories and per-test transaction/reset helpers for every table.
- [ ] Implement idempotent development seed infrastructure with provisioned auth-ID mapping and fixed role rows.
- [ ] Seed only mapped base users/roles in Phase 1; leave transactional demo records to their owning feature phases.

### Shared server contracts and RBAC

- [ ] Implement `ActionResult`, error-code schema, validation flattening, safe PostgreSQL/domain error mapping, and unit tests.
- [ ] Implement exact money parsing/format serialization helpers and boundary/rounding-rejection tests.
- [ ] Implement verified `getCurrentUser`, inactive/unprovisioned handling, and request-scoped role loading.
- [ ] Implement `requireUser`/`requireAnyRole` helpers and exhaustive Admin/Sales/Inventory permission tests.
- [ ] Implement Next.js 16 `proxy.ts` session refresh, protected/public redirects, safe `next` handling, and Proxy tests.
- [ ] Implement protected dashboard layout, role-aware navigation model, and module layout guards.
- [ ] Build the responsive accessible application shell, breadcrumbs, user menu, skip link, and route skeletons.
- [ ] Implement shared 403, 404, route error, global error, and typed action-error UI.

### Authentication and user administration

- [ ] Implement shared sign-in schema and `signIn`/`signOut` actions with safe errors, active-user checks, audit writes, and tests.
- [ ] Build accessible login page/form with pending, invalid-credential, inactive-user, and redirect states.
- [ ] Add Playwright login/logout and protected-route redirect coverage.
- [ ] Implement user list query with role/status/search/pagination and Admin-only query tests.
- [ ] Implement `setUserRoles` service/action with transactional last-Admin protection, audit event, and concurrency tests.
- [ ] Implement `setUserActive` service/action with last-Admin protection, audit event, and tests.
- [ ] Build Admin Users TanStack grid, role dialog, enable/disable confirmation, and component tests.

### Shared UI infrastructure

- [ ] Build typed URL list-query parsing, canonical parameter helpers, escaped search helpers, and unit tests.
- [ ] Build reusable TanStack `DataTable`, toolbar, sorting, visibility, and server-pagination controls with accessibility tests.
- [ ] Build shared table skeleton, unfiltered/filtered empty states, status badge, local date, and money display components.
- [ ] Build shared form error summary, action error alert, submit button, confirmation dialog, currency input, and quantity input.
- [ ] Build server-fed searchable combobox with keyboard and empty-state tests.
- [ ] Configure `"use cache"`, `cacheLife`, `cacheTag`, `updateTag`, and `revalidatePath` helpers/tests without deprecated single-argument `revalidateTag` or `unstable_*` APIs.

Phase 1 gate:

- [ ] Run migrations against a clean database and verify every schema constraint/trigger test.
- [ ] Run format, lint, typecheck, unit/component tests, integration tests, build, and auth Playwright tests.
- [ ] Verify no privileged Supabase/database credential appears in the client bundle.

## Phase 2 — Inventory

### Categories

- [ ] Implement category Zod schemas, slug normalization, and valid/invalid/duplicate-shape unit tests.
- [ ] Implement paginated category queries with product counts, filters, sorting allowlist, and query integration tests.
- [ ] Implement `createCategory` service/action with role check, uniqueness mapping, audit event, revalidation, and tests.
- [ ] Implement `updateCategory` service/action with changed-field audit metadata, revalidation, and tests.
- [ ] Implement `setCategoryActive` with active-product conflict, restore behavior, audit events, and tests.
- [ ] Build Categories page and TanStack grid with URL state, empty/loading/error states, and role-aware actions.
- [ ] Build create/edit category dialog and archive/restore flow with validation/conflict/component tests.

### Products

- [ ] Implement product Zod schemas, uppercase SKU/money/quantity normalization, and boundary tests.
- [ ] Implement product list/detail queries with category/status/low-stock/search filters, allowlisted sorting, and integration tests.
- [ ] Implement stock movement list queries with product/type/actor/date/order filters and integration tests.
- [ ] Implement `createProduct` with active-category validation, optional opening movement, audit event, revalidation, and transaction tests.
- [ ] Implement `updateProduct` without stock mutation, including SKU conflicts, inactive-category handling, audit diff, and tests.
- [ ] Implement `setProductActive` with category restore rules, audit events, revalidation, and tests.
- [ ] Implement `adjustStock` with conditional non-negative update, append-only movement/audit records, cache invalidation, and rollback tests.
- [ ] Build Products page and TanStack grid with stock/low-stock presentation, URL controls, row actions, and component tests.
- [ ] Build Product create/edit forms with active-category options, currency/quantity fields, prerequisite state, and component tests.
- [ ] Build Product detail page with summary, status actions, and paginated movement table.
- [ ] Build stock-adjustment dialog with required reason, negative-result recovery, pending state, and component tests.
- [ ] Build cross-product Stock Movements page/grid with filters, entity links, and append-only presentation.
- [ ] Add idempotent demo category/product/opening-movement seed data through the completed inventory services.
- [ ] Add RBAC integration tests proving Sales cannot administer inventory or invoke inventory actions.

Phase 2 gate:

- [ ] Run format, lint, typecheck, inventory unit/component/integration tests, full build, and inventory accessibility checks.

## Phase 3 — Customers

- [ ] Implement customer Zod schemas with normalized email/country/contact/address boundaries and tests.
- [ ] Implement customer list/detail/order-history queries with search/status/sort/pagination and integration tests.
- [ ] Implement `createCustomer` with uniqueness mapping, audit event, revalidation, and role/action tests.
- [ ] Implement `updateCustomer` with changed-field audit metadata, uniqueness/conflict handling, revalidation, and tests.
- [ ] Implement `setCustomerActive` archive/restore behavior, audit events, and tests.
- [ ] Build Customers page and TanStack grid with order count, confirmed sales, URL state, and empty/error/loading states.
- [ ] Build reusable Customer form for create/edit with grouped fields, duplicate email mapping, accessibility, and component tests.
- [ ] Build Customer create and edit pages with success navigation and archived-state copy.
- [ ] Build Customer detail page with contact/address summary, KPIs, archive controls, and order-history grid.
- [ ] Add idempotent demo customer seed data through the completed customer services.
- [ ] Add RBAC integration tests proving Inventory cannot browse customer administration or invoke customer actions.

Phase 3 gate:

- [ ] Run format, lint, typecheck, customer unit/component/integration tests, build, and customer-form accessibility checks.

## Phase 4 — Sales order drafts and wizard

### Order domain and reads

- [ ] Implement order line/draft/transition/cancel Zod schemas with unique-product, quantity, line-count, reason, and version tests.
- [ ] Implement pure order total/snapshot mapping and lifecycle permission helpers with exhaustive tests.
- [ ] Implement role-projected order list/detail queries with status/customer/date/creator filters and integration tests.
- [ ] Implement active customer/product selector queries that expose only required serialized fields.
- [ ] Implement `createDraftOrder` with server price snapshots, exact totals, version 1, audit event, revalidation, and transaction tests.
- [ ] Implement `updateDraftOrder` with version concurrency, draft-only line replacement, refreshed snapshots/totals, audit event, and tests.
- [ ] Add tests proving draft create/update never changes product stock, invoices, or ledger entries.

### Order UI

- [ ] Build per-instance Zustand order-wizard store with reset/hydration behavior and store tests.
- [ ] Build wizard shell/progress/navigation with step validation, focus management, live announcements, and component tests.
- [ ] Build customer step with active-customer combobox, contact preview, prerequisite/empty states, and tests.
- [ ] Build line-items step with product picker, unique rows, quantity editing, availability display, totals, and tests.
- [ ] Build review step with notes, snapshot warnings, save-draft action, error recovery, and tests.
- [ ] Build New Order page that creates a draft, resets transient state only on success, and links to edit/detail.
- [ ] Build Edit Draft page that hydrates wizard state, submits ID/version, and preserves local input on concurrency conflict.
- [ ] Build role-projected Orders page/grid with URL filters, status badges, totals hidden for Inventory, and component tests.
- [ ] Build Order detail page with snapshot lines, totals, actors, timeline, role-aware action slots, and inaccessible/not-found states.
- [ ] Add component/accessibility tests for keyboard-only wizard completion and insufficient/stale-state error presentation.

Phase 4 gate:

- [ ] Run format, lint, typecheck, order draft unit/component/integration tests, build, and wizard accessibility checks.

## Phase 5 — Confirmation, invoicing, ledger, and fulfillment

### Cross-module workflows

- [ ] Implement internal invoice creation and voiding repositories with one-per-order and immutable amount tests.
- [ ] Implement internal balanced sale/reversal journal writer with deferred-constraint and append-only tests.
- [ ] Implement confirm-order product locking/conditional deduction helper with deterministic lock order and concurrency tests.
- [ ] Implement `confirmOrder` transaction across status, stock movements, invoice, sale journal, and audit events.
- [ ] Test successful multi-line confirmation totals, snapshots, resulting balances, invoice uniqueness, journal balance, version, and audits.
- [ ] Test insufficient-stock confirmation rolls back every order, stock, movement, invoice, ledger, and audit side effect.
- [ ] Test competing confirmations cannot oversell and produce one valid atomic outcome for limited stock.
- [ ] Implement `fulfillOrder` confirmed-only versioned transition with actor/time, audit event, revalidation, and tests.
- [ ] Implement draft and confirmed branches of `cancelOrder`, including restock, movements, invoice void, reversal journal, audit events, and tests.
- [ ] Test fulfilled/cancelled terminal transitions and stale lifecycle submissions fail without partial writes.
- [ ] Wire order detail/wizard Confirm, Fulfill, and Cancel controls with explicit side-effect dialogs and typed conflict recovery.

### Invoices and PDF

- [ ] Implement invoice list/detail view-model queries with Admin/Sales authorization, filters, serialization, and tests.
- [ ] Build Invoice register TanStack grid with status/customer/date filters, void state, links, and download action.
- [ ] Build server-rendered Invoice detail page with snapshot lines, bill-to data, totals, order link, and VOID treatment.
- [ ] Build shared invoice document view model and `@react-pdf/renderer` document with deterministic content tests.
- [ ] Implement authenticated `GET /api/invoices/[invoiceId]/pdf` streaming handler with safe filename/headers/statuses and tests.
- [ ] Add tests proving Inventory and unauthenticated users cannot read invoice pages/data or download PDFs.

### Ledger

- [ ] Implement Admin-only ledger list query with journal/date/account/reference filters, pagination, balance projection, and tests.
- [ ] Build read-only Ledger TanStack grid with grouped journals, debit/credit columns, links, and balance indicator.
- [ ] Add invariant-error UI/logging for any unbalanced journal returned by a read.
- [ ] Add tests proving non-Admin roles cannot query ledger data or access the ledger route.

### Critical browser flow

- [ ] Add Playwright flow: Sales creates/selects customer, builds multi-line order, saves/confirms, sees stock-safe success, and opens invoice.
- [ ] Extend Playwright flow to assert authenticated PDF response and meaningful invoice content/headers.
- [ ] Add Playwright flow: Inventory sees confirmed operational order and fulfills it without revenue/invoice visibility.
- [ ] Add Playwright RBAC smoke test for forbidden invoice/ledger route and direct unauthorized action submission.
- [ ] Add idempotent lifecycle-varied demo order seed data through completed order services, producing coherent invoices, movements, journals, and audits.

Phase 5 gate:

- [ ] Run format, lint, typecheck, all unit/component/integration tests, build, critical Playwright flows, PDF tests, and invoice/order accessibility checks.

## Phase 6 — Streamed dashboard

- [ ] Implement role-aware dashboard date-range schema and canonical URL handling with tests.
- [ ] Implement net revenue-over-time from Sales Revenue postings with daily/monthly buckets, role-safe cache variant/tag, and integration tests.
- [ ] Implement top-products by positive net sale/reversal units with revenue projection for Admin/Sales, unit-only projection for Inventory, and role-safe caching.
- [ ] Implement low-stock aggregate query/cache tag with Admin/Inventory authorization and tests.
- [ ] Implement recent-orders aggregate with separate sales/operations cache keys, common invalidation tag, role-specific fields, and tests.
- [ ] Build dashboard shell/date-range selector with URL state and role-aware widget composition.
- [ ] Build Revenue Recharts client renderer with serialized data, tooltip, text summary, responsive sizing, and component tests.
- [ ] Build Top Products chart/list with role-safe labels, empty state, text summary, and tests.
- [ ] Build Low Stock widget with product links and role-appropriate empty state.
- [ ] Build Recent Orders widget with role-safe fields, status badges, and links.
- [ ] Wrap every widget in independent Suspense fallback and local error boundary; test one failed widget does not block siblings.
- [ ] Verify confirm/cancel/adjust mutations invalidate only the documented dashboard tags and paths.
- [ ] Add dashboard axe checks and a slow-query streaming smoke test.

Phase 6 gate:

- [ ] Run format, lint, typecheck, dashboard unit/component/integration tests, build, and dashboard accessibility/streaming checks.

## Phase 7 — Audit UI, release hardening, and deployment

### Audit log

- [ ] Centralize fixed audit event names, metadata redaction, correlation handling, and unit tests.
- [ ] Audit every implemented mutation against the API event vocabulary and add missing transaction-level assertions.
- [ ] Implement Admin-only audit list query with actor/action/entity/date filters, pagination, sanitized metadata, and tests.
- [ ] Build Audit Log TanStack grid with URL filters, entity links, actor/timestamp, and append-only empty/error/loading states.
- [ ] Build accessible Audit Details sheet for sanitized before/after/context metadata.
- [ ] Add tests proving audit rows reject application/database update/delete and non-Admins cannot query/view them.

### Production readiness

- [ ] Compose the feature seeds into one full idempotent demo command and document secure provisioning of Admin/Sales/Inventory Supabase Auth users.
- [ ] Add repository README with pitch, two-minute demo script, architecture highlights, screenshots, local setup, test commands, and deployment steps.
- [ ] Add Supabase local/deployed migration instructions, runtime/migration role setup, RLS verification, and backup/reset cautions.
- [ ] Configure Vercel deployment environment and Supabase redirect URLs without exposing privileged credentials.
- [ ] Add production health smoke checks for login, database connectivity, protected routes, and PDF generation.
- [ ] Run and fix complete CI from a clean clone and clean database.
- [ ] Run full Playwright suite against a Vercel preview with deterministic seeded data.
- [ ] Run keyboard and axe review for login, shell, all forms/grids, order wizard, invoice, dashboard, and audit details.
- [ ] Run responsive review at mobile, tablet, laptop, and wide desktop sizes; fix overflow and focus issues.
- [ ] Run performance review for dashboard streaming, list-query bounds, database query plans/index use, and client bundle boundaries.
- [ ] Run security review for secrets, auth/session trust, role/action bypass, open redirects, unsafe search SQL, headers, logs, and PDF authorization.
- [ ] Verify every cache invalidation path against `ARCHITECTURE.md` and remove accidental shared caching of user-sensitive data.
- [ ] Verify implementation/docs parity and update all seven specs for approved final behavior.
- [ ] Tag and deploy the MVP only after all phase gates pass.

MVP completion gate:

- [ ] Execute the two-minute demo end to end on production using each role.
- [ ] Verify all required CI checks pass and no critical accessibility/security issue remains.
- [ ] Receive explicit approval before beginning any Phase 8 item.

## Phase 8 — Optional stretch scope

Every item below is optional and blocked until explicit post-MVP approval.

### Optimistic order UI

- [ ] **[STRETCH]** Specify optimistic order UX, rollback semantics, duplicate-submit handling, and Server Action reconciliation before coding.
- [ ] **[STRETCH]** Add `useOptimistic` to approved order interactions without moving authoritative totals/stock to the client.
- [ ] **[STRETCH]** Add component and concurrency tests for optimistic success, server correction, rollback, and conflict.

### Supabase Realtime stock

- [ ] **[STRETCH]** Specify Realtime channel scope, RLS policy, reconnect behavior, and subscription cleanup.
- [ ] **[STRETCH]** Add narrowly scoped stock subscriptions to product/order availability client islands.
- [ ] **[STRETCH]** Test role isolation, reconnect, duplicate event, and stale-event handling.

### Email confirmation

- [ ] **[STRETCH]** Specify provider, verified sender, idempotency, retry, privacy, and local capture strategy.
- [ ] **[STRETCH]** Add transactional outbox table/migration and enqueue order-confirmation events after successful confirmation data writes.
- [ ] **[STRETCH]** Add Resend worker/webhook route handlers with signature verification, idempotency, retry state, and tests.
- [ ] **[STRETCH]** Build and test accessible order confirmation email with invoice/order link; do not attach privileged URLs.

### Global command palette

- [ ] **[STRETCH]** Specify role-filtered command sources, keyboard behavior, and server search limits.
- [ ] **[STRETCH]** Build `cmd+k` palette for navigation and authorized customer/product/order search.
- [ ] **[STRETCH]** Add keyboard, screen-reader, RBAC, and search-debounce tests.

### CSV product import

- [ ] **[STRETCH]** Specify CSV columns, size/row limits, duplicate policy, dry-run behavior, and downloadable error format.
- [ ] **[STRETCH]** Build streaming/bounded CSV parser and per-row shared-schema validation without loading unbounded files.
- [ ] **[STRETCH]** Implement Admin/Inventory dry run and atomic/approved partial import Server Action or route handler with audit summary.
- [ ] **[STRETCH]** Build import/review/result UI and tests for malformed, duplicate, oversized, unauthorized, and successful files.

Stretch gate:

- [ ] **[STRETCH]** Run full MVP regression, new feature tests, build, accessibility/security review, and preview deployment before each stretch release.
