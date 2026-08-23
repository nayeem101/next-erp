# NextERP Project Progress

## Current status

- Last updated: 2026-08-22
- Current phase: Phase 1 — Foundation, database, authentication, and RBAC
- Status: Phase 1 "Supabase and Drizzle" section complete (all nineteen checklist items)
- Active task: None
- Next eligible task: Add root `.cursorignore` exclusions for secrets, dependencies, build/test artifacts, lockfile, and generated PDFs
- Blocker: User review before the next task

`docs/TASKS.md` is the authoritative task checklist. This file summarizes execution status and evidence; it does not replace the task plan.

## Phase status

- Phase 0 — Specification: Complete and approved
- Phase 1 — Foundation, database, authentication, and RBAC: In progress
- Phase 2 — Inventory: Not started
- Phase 3 — Customers: Not started
- Phase 4 — Sales order drafts and wizard: Not started
- Phase 5 — Confirmation, invoicing, ledger, and fulfillment: Not started
- Phase 6 — Streamed dashboard: Not started
- Phase 7 — Audit UI, release hardening, and deployment: Not started
- Phase 8 — Optional stretch scope: Locked until MVP completion and explicit approval

## Update protocol

After every completed task from `docs/TASKS.md`:

1. Run the task's required lint, typecheck, and test checks.
2. Mark only that task complete in `docs/TASKS.md`.
3. Update the date, phase status, active task, next eligible task, and blocker above.
4. Add a newest-first entry to the execution log with changed areas and verification evidence.
5. Record a commit hash only when the user explicitly requested and approved creating the commit.
6. Do not mark a phase complete until its phase gate passes.

## Execution log

### 2026-08-22 — Development seed infrastructure completed

- Added `src/db/seed.mts`, a Node-runnable (native TypeScript) seed module with relative imports: validates `SEED_DEMO_ADMIN_ID`/`SEED_DEMO_SALES_ID`/`SEED_DEMO_INVENTORY_ID` through Zod, loads `.env.local` without overriding real environment values, fails with an actionable message for unmapped identities, inserts the three fixed role rows idempotently, ensures application users exist from the provisioned auth identities, and assigns roles idempotently with the Admin holding all three roles.
- Wired the `db:seed` package script, documented the mapping variables in `.env.example`, and verified the CLI end to end twice against the disposable database (idempotent).
- Added four seed integration tests covering role-row creation, multi-role admin mapping, triple-run idempotency, and unmapped-identity rejection; Phase 1 seeds only mapped base users/roles per plan.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (28 passing), integration tests (78 passing), production build.

### 2026-08-22 — Test factories and transaction helpers completed

- Added `src/test/factories/db.ts`: shared prepared integration connection, `withRolledBackTransaction()` on a dedicated reserved connection (always rolls back, keeping suites order-independent), an overridable deterministic UUID factory, and a fixed-epoch `fixedDate(offset)` timestamp helper.
- Added `src/test/factories/factories.ts` covering every table: auth identity provisioning through the sync trigger, role lookup and idempotent membership assignment, category/product/customer creation with explicit overrides, and draft-order/line/confirm/fulfill/cancel lifecycle helpers — all accepting an optional transaction handle.
- Added six factory integration tests proving override application, idempotent assignment, full lifecycle driving, zero residue across rolled-back writes, and deterministic timestamps.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (28 passing), integration tests (74 passing).

### 2026-08-22 — Drizzle relations and schema barrel completed

- Added `src/db/schema/relations.ts` with inferred relations across the full ERD: user/role membership, category-product, customer-order, order-line/product, order-invoice, order/invoice-ledger, product/order-stock movements, and audit actor links (with relation-name disambiguation where tables reference each other more than once).
- Added a server-safe `src/db/schema/index.ts` barrel exporting every table object, enum, sequence, snapshot type, and relation definition; `getDb()` now passes the schema into the Drizzle instance so relational queries are available.
- Added a barrel smoke unit test asserting table exports, enum values, sequence presence, and module identity; kept test files outside drizzle-kit's schema scan.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (28 passing), integration tests (68 passing), and a no-op regeneration confirming no schema drift.

### 2026-08-22 — RLS hardening completed

- Added custom migration `0009_rls-hardening.sql`: row-level security enabled on all twelve application tables; an idempotent non-owner `nexterp_runtime` role (NOLOGIN, no superuser/bypassrls/createdb/createrole) with least-privilege grants — full CRUD on business tables, read-only `roles`, SELECT/INSERT only on the three append-only trails with explicit UPDATE/DELETE revocation, and sequence usage for order/invoice numbering; permissive policies scoped `TO nexterp_runtime` only; and a hosted-parity block that strips all table/sequence privileges from `anon`/`authenticated` wherever those roles exist.
- The test bootstrap now creates local `anon`/`authenticated` role stubs so RLS behavior mirrors a hosted Supabase project.
- Added six integration tests: catalog verification of RLS enablement and runtime-role privilege flags, runtime-role business-table CRUD, append-only UPDATE/DELETE denial (42501) with reads still permitted, browser-role zero-row visibility plus VALUES-based insert denial despite granted table privileges, and runtime sequence access.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (25 passing), integration tests (68 passing) against a database rebuilt from an empty state.

### 2026-08-22 — Lifecycle and integrity migration completed

- Added custom migration `0008_lifecycle-controls.sql`: `set_updated_at()` triggers on users/customers/categories/products/orders; an order lifecycle trigger enforcing the legal transition matrix, confirmation/fulfillment/cancellation actor-timestamp-reason requirements, and customer/currency/total immutability once an order leaves draft; a line-item guard that freezes lines on non-draft orders while still permitting the draft-order cascade delete; a `DEFERRABLE INITIALLY DEFERRED` constraint trigger requiring exactly two balanced entries per affected journal at commit; append-only rejection triggers for stock movements and ledger entries plus an audit-specific trigger whose only permitted update is the ON DELETE SET NULL actor safety valve.
- Added eight integration tests: automatic `updated_at` refresh, legal confirm→fulfill path, skipped/reversed/terminal transition rejections, missing actors/reasons rejections, snapshot-field freezing with non-snapshot fields still writable, line-item lockout after draft (update/delete/insert), unbalanced and single-entry journal commit failures, and stock-movement update/delete rejection with SQLSTATE 55006.
- Existing suites were updated to respect the new invariants: ledger postings now run as balanced pairs inside transactions, and movement fixtures confirm orders through the legal path.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (25 passing), integration tests (62 passing) against a database rebuilt from an empty state.

### 2026-08-22 — Stock movements, ledger, and audit schemas completed

- Added `stock_movement_type`, `ledger_account`, `ledger_side`, and `journal_type` enums plus three schema files: `stock-movements.ts` (append-only columns via shared `createdAtOnly`, product/order references, nonzero-delta and nonnegative-result checks, order-reference type check), `ledger.ts` (journal grouping with per-journal account uniqueness, positive amounts, normal-side accounting rules for sale/reversal journals), and `audit.ts` (polymorphic entity reference, structured metadata JSONB defaulting to empty, correlation IDs, four query indexes).
- Generated migrations `0006_stock-movements.sql` and `0007_ledger-audit.sql` (drizzle-kit captured both remaining tables in one migration; file renamed and journal updated accordingly); the full chain re-applies cleanly from an empty database.
- Added nine integration tests: sale/opening/adjustment order-reference rules, zero-delta and negative-result rejections, balanced normal-side postings including reversal mirroring, amount/journal-uniqueness rules, structured audit metadata with anonymous actors, actor SET NULL on identity deletion, and audit query index presence.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (25 passing), integration tests (54 passing), production build.

### 2026-08-22 — Invoices schema completed

- Added `invoice_status` to the shared enums module and `src/db/schema/invoices.ts` with the `invoice_number_seq` sequence (start 1000), INV-number default, one-invoice-per-order uniqueness, positive/matching amount checks, USD-only check, typed seller/bill-to JSONB snapshots with required-key shape checks, status+issued-at index, and RESTRICT references.
- Generated and reviewed migration `0005_invoices.sql`; applied it to the disposable database.
- Added five integration tests: sequential INV numbering, per-order invoice uniqueness, zero and mismatched amount rejections, snapshot shape enforcement (missing required key), optional snapshot fields plus issued-status defaults.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (25 passing), integration tests (44 passing).

### 2026-08-22 — Orders schema completed

- Added `src/db/schema/orders.ts` with the `order_number_seq` sequence (start 1000), `orders` (SO-number default via `nextval`, status/version/currency/total checks, lifecycle actor/timestamp columns, status+created-at and customer/creator indexes) and `order_line_items` (SKU/name snapshots, per-order product uniqueness, quantity/price/total-matches checks, cascade-on-order-delete).
- Worked around a drizzle-kit BigInt snapshot bug by declaring `total_cents` default as raw SQL (`sql\`0\``); added a shared `enums.ts`for`order_status`.
- Generated and reviewed migration `0004_orders.sql`; applied it to the disposable database.
- Added six integration tests: sequential SO numbering, draft defaults (version 1, USD, zero total), version/total/currency check rejections, one-product-per-order uniqueness, quantity/line-total constraint rejections, and line-item cascade plus referenced-product restriction ordering.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (25 passing), integration tests (39 passing).

### 2026-08-22 — Customers schema completed

- Added `src/db/schema/customers.ts` with normalized email uniqueness, name/active indexes, required postal address fields, optional contact/company/notes fields, and RESTRICT actor references.
- Generated and reviewed migration `0003_customers.sql`; applied it to the disposable database.
- Added five integration tests covering case-insensitive email conflicts, required address columns (not-null violation), user-delete restriction through customer references, optional-field defaults, and index presence.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (25 passing), integration tests (33 passing).

### 2026-08-22 — Categories/products schema completed

- Added `src/db/schema/inventory.ts` with `categories` (case-normalized name uniqueness, slug uniqueness, active index) and `products` (upper-normalized SKU uniqueness, positive price, non-negative stock/reorder checks, category/actor foreign keys with RESTRICT, and the partial low-stock index on active products).
- Generated and reviewed migration `0002_inventory.sql`; applied it to the disposable database.
- Added seven integration tests covering case-insensitive name/SKU conflicts, slug uniqueness, price/stock/reorder check rejections, referenced-category delete restriction, column defaults, and the partial low-stock index definition.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (25 passing), integration tests (28 passing).

### 2026-08-22 — Auth identity synchronization trigger completed

- Added custom migration `0001_auth_identity_sync.sql` with a hardened `SECURITY DEFINER` trigger function (`search_path=""`, fully qualified objects, EXECUTE revoked from PUBLIC/anon/authenticated) that mirrors `auth.users` inserts into `public.users`, synchronizes trimmed email and whitespace-normalized display names (metadata precedence `display_name` → `full_name` → `name`, 120-char cap, email-prefix fallback) on relevant updates, rejects blank emails, and never assigns a role.
- Added ten integration tests: identity mirroring, zero default roles, non-string metadata fallback, oversize capping, blank-email rejection (23514), duplicate-email rejection across identities (23505), email and display-name synchronization, provisioning by a restricted invoker with no `public.users` privileges, and definer/search-path/EXECUTE-hardening introspection.
- Discovered and documented that postgres.js double-encodes manually stringified JSON parameters; the suite uses `sql.json()` bindings instead.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (25 passing), integration tests (21 passing).

### 2026-08-22 — Identity schema and migration completed

- Added `src/db/schema/auth.ts` (read-only `auth.users` declaration), `src/db/schema/users.ts` (`role_key` enum, `roles`, `users`, `user_roles` with case-normalized email uniqueness, active flag index, composite role PK, and cascade/restrict/set-null referential actions), and `src/db/schema/shared.ts` timestamp helpers.
- Generated migration `0000_identity.sql`; hand-reviewed and removed the generated `CREATE SCHEMA auth`/`CREATE TABLE auth.users` statements so migrations manage only the public schema while the external foreign key remains; verified a subsequent generate produces no schema diff.
- Added the disposable-database bootstrap (`src/db/test/bootstrap.sql` + `db:test:bootstrap` script) that mimics the Supabase auth subset on vanilla Postgres, plus `src/db/test/setup-db.ts` which applies bootstrap + all committed migrations idempotently for integration suites.
- Added nine integration tests asserting enum values, unique/not-null constraints, FK delete rules (RESTRICT to auth identity, CASCADE/RESTRICT on user_roles, SET NULL assigner), case-normalized email uniqueness, and composite key ordering against the live disposable database.

### 2026-08-22 — Drizzle Kit and disposable integration database completed

- Added `drizzle-kit` 0.31.10 with a root `drizzle.config.ts`: PostgreSQL dialect, schema under `src/db/schema`, migrations output to `src/db/migrations`, `schemaFilter: ["public"]` so only the public schema is managed, strict/verbose generation.
- Added `db:generate` and `db:migrate` package scripts.
- Added a disposable integration-test database via `docker-compose.yml` (Postgres 17 alpine on localhost:54329, tmpfs data directory) with `db:test:start`/`db:test:stop` scripts and health-gated startup.
- The Vitest integration config now defaults `INTEGRATION_DATABASE_URL` to the compose database, so `pnpm test:integration` runs with no manual environment setup; the CI Quality job gained an equivalent Postgres service container and passes the URL to the integration step.
- Approved the previously placeholder `esbuild` build script in `pnpm-workspace.yaml` required by drizzle-kit.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (25 passing), and the Drizzle connection smoke suite against the disposable database (start → test → stop verified).

### 2026-08-22 — Server-only Drizzle client completed

- Added `drizzle-orm` 0.45.2 with the `postgres` 3.4.9 driver.
- Added a lazy, server-only `getDb()` singleton under `src/db/index.ts` that reads `DATABASE_URL` through the validated server environment module and disables prepared statements (`prepare: false`) for the Supabase transaction-mode pooler.
- Documented restricted runtime credential expectations in `.env.example` (least-privilege role via pooler port 6543; never migration/secret credentials).
- Added unit tests for driver options, `prepare: false`, instance caching, and test-cache reset; added a connection smoke integration suite covering `SELECT 1` and in-transaction execution that skips when no database URL is configured.
- Started a disposable Postgres 17 Docker container on localhost:54329 for integration verification; smoke tests passed against it (2/2).
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (25 passing), and integration smoke tests against the disposable database.

### 2026-08-22 — Supabase clients and cookie adaptation tests completed

- Verified browser, server, Proxy, and admin Supabase clients against the installed `@supabase/ssr` 0.12.4 cookie adapter types (`getAll`/`setAll` with cache-prevention headers) and the Next.js 16 `proxy.ts` file convention.
- Extracted the Proxy Supabase client into a testable `createProxyClient(request)` factory under `src/lib/supabase/proxy.ts`; `src/proxy.ts` now only refreshes claims and returns the latest response.
- Added unit tests proving cookie adaptation for all four clients: server reads via `next/headers` and swallows RSC write failures; Proxy propagates refreshed cookies to request and response plus required no-cache headers; admin client uses the secret key without session persistence.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (21 passing), production build with Proxy detected.

### 2026-07-22 — Environment validation modules completed

- Added Zod schemas for public Supabase values, server credentials, and required seller identity fields with optional address/region normalization.
- Adopted current Supabase API key env names: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and server-only `SUPABASE_SECRET_KEY`.
- Added browser-safe `getPublicEnv`, server-only `getServerEnv`/`getSellerIdentity`, and invoice-shaped seller snapshot mapping.
- Added `.env.example` with placeholders only and allowed that file through `.gitignore` while still ignoring real env files.
- Added unit coverage for valid/invalid boundaries, caching, and incomplete-server failures; stubbed `server-only` for Vitest.
- Checks passed: Prettier, ESLint, strict typecheck, unit tests, Playwright smoke tests, production build, and IDE diagnostics.

### 2026-07-22 — CI workflow completed

- Added a GitHub Actions pull-request and `main` workflow with Quality and Playwright jobs.
- Quality runs frozen install, format check, lint, typecheck, unit/component tests, integration tests, and production build.
- Playwright installs Chromium with OS dependencies, runs the browser suite under `CI`, and uploads failure artifacts.
- Added `test:integration` with a Node Vitest config that passes with no suites until database integration tests exist, and excluded those suites from the unit runner.
- Disabled Husky in CI and pinned Node from `.nvmrc` with pnpm caching.
- Checks passed: Prettier, ESLint, strict typecheck, unit tests, empty integration suite, Playwright smoke tests, production build, and IDE diagnostics.

### 2026-07-22 — Pre-commit quality checks completed

- Added Husky initialization through the package-manager `prepare` lifecycle.
- Added a tracked pre-commit hook that runs lint-staged without invoking full unit, database, build, or browser suites.
- Configured ESLint auto-fixes followed by Prettier for staged JavaScript/TypeScript files and Prettier for supported data, style, and documentation files.
- Verified Husky installation, Git hook routing, lint-staged configuration loading, and the installed pre-commit entrypoint.
- Checks passed: Prettier, ESLint, strict typecheck, unit tests, production build, and IDE diagnostics.

### 2026-07-22 — Playwright test foundation completed

- Added Playwright with desktop Chromium and Pixel 7 mobile Chromium projects.
- Configured Playwright-owned local Next.js server lifecycle and external preview/deployment targeting through a validated environment contract.
- Added CI-safe retries, single-worker execution, focused-test protection, trace-on-first-retry, and failure screenshots/videos.
- Added package scripts, ignored generated artifacts, documented test-only variables, and added a passing application-shell browser smoke test.
- Checks passed: two Playwright project tests, Prettier, ESLint, strict typecheck, unit tests, production build, and IDE diagnostics.

### 2026-07-22 — Unit and component test foundation completed

- Added Vitest 4 with the V8 coverage provider, React Testing Library, jest-dom matchers, user-event, and jsdom.
- Configured the `@/*` alias, React transformation, deterministic mock cleanup, and shared DOM test setup.
- Added the documented coverage floor for future `src/features/**` code: 80% lines/functions and 75% branches.
- Added `test`, `test:watch`, and `test:coverage` scripts plus a passing accessible-interaction smoke test.
- Checks passed: Vitest, coverage execution, ESLint, strict typecheck, production build, and IDE diagnostics.

### 2026-07-22 — Code quality tooling completed

- Added type-aware strict and stylistic TypeScript ESLint rules on top of the Next.js Core Web Vitals configuration.
- Enforced deterministic import groups, type-only imports, duplicate prevention, and zero-warning lint runs.
- Added Prettier with Tailwind CSS class sorting, repository-wide formatting scripts, and a clean formatting baseline.
- Added explicit `format`, `format:check`, `lint`, `lint:fix`, and `typecheck` package scripts.
- Checks passed: Prettier, ESLint, strict typecheck, production build, and IDE diagnostics.

### 2026-07-22 — shadcn/ui foundation completed

- Initialized the current shadcn/ui `base-nova` preset for Tailwind CSS 4, React 19, RSC, Base UI, and Lucide icons.
- Added owned primitives for buttons, cards, fields, alerts, avatar, breadcrumbs, dropdowns, separators, sheets, skeletons, and tooltips.
- Added accessible light/dark OKLCH tokens for application, sidebar, charts, and success/warning/info states.
- Corrected Geist typography tokens, added root tooltip context, and replaced generated metadata with NextERP metadata.
- Checks passed: ESLint, `tsc --noEmit`, production build, and IDE diagnostics.

### 2026-07-22 — Next.js 16 scaffold completed

- Created the Next.js 16.2.11 App Router project with React 19.2.4, Tailwind CSS 4, ESLint 9, TypeScript 5.9, and `src/` layout.
- Enabled Cache Components and strict TypeScript options.
- Pinned Node.js 24 and pnpm 11.15.1; generated a compatible lockfile and approved only required dependency build scripts.
- Verified the `@/*` import alias and Turbopack production build.
- Checks passed: ESLint, `tsc --noEmit`, production build, and IDE diagnostics. Test tooling is scheduled later in Phase 1, so no test script exists yet.

### 2026-07-22 — Phase 0 specification completed

- Produced the seven required specification documents.
- Standardized the platform on Next.js 16.x, React 19.2+, App Router, `proxy.ts`, and Cache Components.
- Added compact project rules under `.cursor/rules/`.
- Verified documentation consistency and found no linter diagnostics.
- Approval gate remains open; no application code has been written.

## Verification history

- 2026-08-22: Seed CLI verified twice against the disposable database and seed integration tests passed (78 total), with format, lint, strict typecheck, 28 unit tests, and production build green.
- 2026-08-22: Factory integration tests passed (74 total), with format, lint, strict typecheck, and 28 unit tests green.
- 2026-08-22: Relations/barrel task verified with barrel unit tests (28 total), no-op regeneration diff check, full 68-test integration suite, format, lint, and strict typecheck.
- 2026-08-22: RLS migration applied from an empty database and all six hardening integration tests passed; full 68-test integration suite, format, lint, strict typecheck, and 25 unit tests green.
- 2026-08-22: Lifecycle migration applied from an empty database and all eight lifecycle-control integration tests passed; full 62-test integration suite, format, lint, strict typecheck, and 25 unit tests green.
- 2026-08-22: Stock-movement, ledger, and audit migrations applied from an empty database and all nine of their integration tests passed; format, lint, strict typecheck, 25 unit tests, the 54-test integration suite, and production build green.
- 2026-08-22: Invoices schema migration applied and its five integration tests passed; format, lint, strict typecheck, 25 unit tests, and the 44-test integration suite green.
- 2026-08-22: Orders schema migration applied and its six integration tests passed; format, lint, strict typecheck, 25 unit tests, and the 39-test integration suite green.
- 2026-08-22: Customers schema migration applied and its five integration tests passed; format, lint, strict typecheck, 25 unit tests, and the 33-test integration suite green.
- 2026-08-22: Inventory schema migration applied and all seven inventory integration tests passed; format, lint, strict typecheck, 25 unit tests, and the full 28-test integration suite green.
- 2026-08-22: Auth identity-sync trigger migration applied cleanly and all ten trigger integration tests passed alongside format, lint, strict typecheck, 25 unit tests, and the earlier schema suites (21 integration total).
- 2026-08-22: Identity schema migration applied to the disposable database and all nine constraint/integration tests passed; format, lint, strict typecheck, and 25 unit tests green; regeneration produced no diff after the auth-statement removal.
- 2026-08-22: Drizzle Kit config validated and the full integration cycle (compose start, smoke tests, compose stop) passed; format, lint, strict typecheck, and 25 unit tests green.
- 2026-08-22: Drizzle client unit tests passed and connection smoke tests passed against a disposable Postgres 17 container, alongside format, lint, strict typecheck, and the full unit suite.
- 2026-08-22: Supabase client cookie-adaptation tests passed with format, lint, strict typecheck, full unit suite, and production build.
- 2026-07-22: Environment schema/accessor unit tests passed with format, lint, typecheck, build, and Playwright.
- 2026-07-22: Local CI gate passed for format, lint, typecheck, unit, integration (empty), build, and Playwright.
- 2026-07-22: Husky prepare lifecycle and pre-commit entrypoint passed; lint-staged loaded successfully with no staged files.
- 2026-07-22: Desktop and mobile Chromium Playwright smoke tests passed with managed Next.js startup and shutdown.
- 2026-07-22: Vitest smoke test and coverage execution passed alongside lint, strict typecheck, and production build.
- 2026-07-22: Code quality formatting, strict lint, strict typecheck, and production build passed.
- 2026-07-22: shadcn/ui foundation lint, strict typecheck, and production build passed.
- 2026-07-22: Scaffold lint, strict typecheck, and Next.js production build passed.
- 2026-07-22: Phase 0 documentation and Cursor rules checked; no linter diagnostics.

## Approved deviations

- 2026-07-22: Supabase public/server credentials use the current publishable/secret API key names (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`) instead of legacy `anon` / `service_role` env names.
