# Codebase Guide

A developer's map of the NextERP source tree: what lives where, what each
module is responsible for, and how the layers connect. Pair this with
`docs/ARCHITECTURE.md` (system design) and `docs/API_SPEC.md` (behavioral
contracts).

## The one rule that explains the structure

**Pages are thin, features are fat.** Everything under `src/app` either
authorizes a request or stitches feature components together; all domain
logic, queries, mutations, and UI live in `src/features/<domain>`. Shared,
domain-agnostic UI lives in `src/components`. Anything that talks to
Supabase, Drizzle, or the cache lives in `src/lib`.

Request flow for a typical page:

```
src/app/(dashboard)/x/page.tsx        ← route shell: metadata, Suspense
  → getActionContext(MODULE_ROLE_REQUIREMENTS.x)   (lib/auth/guards)
  → parseListQuery(searchParams, xSchema)          (lib/list-query/parse)
  → listX(query)                                   (features/x/queries)
  → <XGrid page={...} urlValues={...}/>            (features/x/components)
```

Mutation flow:

```
feature component ("use client")
  → import { xAction } from "@/features/x/actions"   ("use server")
      → zod schema parse            (features/x/schemas)
      → getActionContext(roles)     (lib/auth/guards)
      → service function            (features/x/service.ts)  [one tx]
      → invalidateTags(...)         (lib/cache/invalidate)
      → actionSuccess | mapActionError
```

---

## Top-level layout

| Path                     | Purpose                                                     |
| ------------------------ | ----------------------------------------------------------- |
| `src/app/`               | Routes only: page shells, layouts/guards, route handlers    |
| `src/features/`          | Domain modules — the real application (10 domains)          |
| `src/components/ui/`     | Primitives from shadcn/Radix (button, card, dialog…)        |
| `src/components/shared/` | App-level reusable components (data table, combobox…)       |
| `src/lib/`               | Cross-cutting infrastructure (auth, cache, errors, env…)    |
| `src/db/`                | Drizzle schema files, migrations, seed script               |
| `src/test/`              | Test factories, setup, `server-only` stub                   |
| `e2e/`                   | Playwright specs + environment config                       |
| `scripts/`               | Node scripts (demo seed, test-db bootstrap)                 |
| `docs/`                  | Specs (PRD/UI/API/ARCHITECTURE/DATABASE_SCHEMA), TASKS plan |

---

## Feature modules (`src/features/<domain>/`)

Every module follows the same internal shape; file names are consistent on
purpose:

| File                        | Layer          | Rules                                                                             |
| --------------------------- | -------------- | --------------------------------------------------------------------------------- |
| `schemas.ts`                | Contracts      | Browser-safe zod schemas + result types. No server imports.                       |
| `queries.ts`                | Reads          | `"use cache"` where allowed; `server-only`; returns plain serializable data.      |
| `service.ts` / domain files | Writes         | One transaction per mutation; audit events written in-tx via `writeAuditEvent`.   |
| `actions.ts`                | Server Actions | `"use server"` entry points: validate → authorize → delegate → invalidate caches. |
| `demo-seed.ts`              | Seed           | Optional; idempotent existence checks then delegates to the production service.   |
| `components/`               | UI             | Server wrappers where possible; `"use client"` only when interactive.             |

### auth — sign-in and identity sync

- `service.ts`: verifies Supabase session against the app `users` table,
  stamps `last_signed_in_at`, writes `auth.signed_in`.
- `actions.ts` + `components/login-form.tsx`: the login form;
  safe-redirect handling lives in `lib/auth/safe-redirect.ts`.
- Used by: `(auth)/login/page.tsx`, middleware/proxy protection.

### categories

- `service.ts` create/update/setActive (archive vs restore by flag),
- `actions.ts`, `queries.ts`, grid + form-dialog components.
- Used by: `/inventory/categories`, product form's category options.

### customers

- Full CRUD + archive/restore; `customer-orders-table.tsx` renders a
  customer's order history on the detail page.
- Used by: `/customers*` routes, order wizard customer picker.

### products

- CRUD + archive + **stock adjustment** (`adjustStockAction` writes a
  movement row + audit event in one tx).
- `stock-movement-queries.ts` / `stock-movement-schemas.ts`: movement
  history read models.
- Components: products grid, product form, status actions,
  stock-adjustment dialog, stock-movements grid/table.
- Used by: `/inventory/products*`, `/inventory/stock-movements`,
  dashboard low-stock widget (via its own query).

### orders — the transactional core (largest module)

| File           | Role                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `service.ts`   | Draft creation/update (totals snapshotted server-side).                                                                                                           |
| `confirm.ts`   | `confirmOrder`: single tx — locks draft+customer, deducts stock, issues invoice, posts journal, audits ×3.                                                        |
| `lifecycle.ts` | `fulfillOrder` (confirmed→fulfilled) and `cancelOrder` (draft branch = clean cancel; confirmed branch = restock + void invoice + reversal journal).               |
| `invoices.ts`  | Internal repo used by confirm/cancel: `createIssuedInvoice` (one per order), `voidIssuedInvoice` (issued-only conditional update).                                |
| `ledger.ts`    | Internal journal writer: `postSaleJournal` / `postSaleReversalJournal` (exactly two legs, balanced).                                                              |
| `domain.ts`    | Pure transition rules (which statuses may move where).                                                                                                            |
| `selectors.ts` | Lightweight option lists for the wizard (active customers/products).                                                                                              |
| `wizard/`      | Multi-step draft editor: `new-order-wizard.tsx`, steps (customer / line-items / review), shared client `store.ts`, `edit-draft-wizard.tsx` reuses it for editing. |
| `components/`  | `orders-grid.tsx` (register), `order-detail.tsx`, `order-status-actions.tsx` (Confirm/Fulfill/Cancel dialogs with side-effect copy and conflict recovery).        |

Cross-module note: order services are the **only** writers of invoices and
ledger entries — there are no public actions for those modules.

### invoices

- `queries.ts`: Admin/Sales register + detail reads (snapshots only —
  never current mutable customer data).
- `view-model.ts` + `invoice-pdf.tsx`: deterministic document model feeding
  the `@react-pdf/renderer` document.
- `components/invoices-grid.tsx`: register with status/customer/date
  filters, VOID badges, download links.
- Used by: `/accounting/invoices*`, PDF route handler.

### ledger

- `queries.ts`: Admin-only grouped journal read with type/date/account/
  reference filters, pagination, balance projection.
  `assertJournalsBalanced` throws `[ledger-invariant]` if books are ever
  corrupt; account-filtered partial groups are exempt by design.
- `components/ledger-grid.tsx`: grouped cards with debit/credit columns,
  balance indicator, order/invoice links.
- Used by: `/accounting/ledger`.

### dashboard

- `queries.ts`: four cached aggregates (`"use cache"`): revenue-over-time
  (net Sales Revenue postings, daily/monthly buckets), top products (net
  units ± reversals; revenue only in the `sales` variant), low stock,
  recent orders (`sales` vs `operations` projections). Variants are
  derived server-side from verified roles — never from the browser.
- `components/`: range select (URL state), `widgets.tsx` (server wrappers),
  `revenue-chart.tsx` (Recharts client renderer),
  `widget-error-boundary.tsx` (per-widget isolation).
- Used by: `/dashboard`.

### users

- Role assignment (last-active-admin protected), enable/disable; every
  change audited with before/after role keys.
- Used by: `/admin/users`.

### audit

- `queries.ts`: Admin-only filtered/paginated trail (list rows carry no
  metadata); detail fetch re-sanitizes through redaction as defense in
  depth.
- `components/audit-log-grid.tsx` + `audit-details-sheet.tsx`: URL-filtered
  grid and accessible sheet rendering sanitized before/after/context JSON.
- Used by: `/admin/audit-log`, `/api/audit-log/[id]`.

---

## Routes (`src/app/`)

### Route groups

- `(auth)` — bare layout (no shell) for `/login`.
- `(dashboard)` — authenticated shell: sidebar nav (role-filtered via
  `visibleNavItems`), user menu, mobile nav sheet. Each section layout
  re-checks authorization server-side (`inventory/layout.tsx`,
  `sales/layout.tsx`, `accounting/*/layout.tsx`, `admin/layout.tsx`).
- `api/` — route handlers (below).

### Page inventory

| Route                                           | Renders                                    | Feature used    |
| ----------------------------------------------- | ------------------------------------------ | --------------- |
| `/login`                                        | Login form                                 | `auth`          |
| `/dashboard`                                    | Range selector + role-aware widgets        | `dashboard`     |
| `/inventory/products`                           | Product register (filters/sort/pagination) | `products`      |
| `/inventory/products/new` · `/[productId]/edit` | Product form                               | `products`      |
| `/inventory/products/[productId]`               | Detail + movements + adjust/archive        | `products`      |
| `/inventory/categories`                         | Category manager (grid + dialogs)          | `categories`    |
| `/inventory/stock-movements`                    | Movement ledger table                      | `products`      |
| `/customers` · `/new` · `/[id]` · `/[id]/edit`  | Directory, form, detail w/ orders          | `customers`     |
| `/sales/orders`                                 | Order register                             | `orders`        |
| `/sales/orders/new` · `/[orderId]/edit`         | Wizard (create/edit draft)                 | `orders/wizard` |
| `/sales/orders/[orderId]`                       | Detail + lifecycle action dialogs          | `orders`        |
| `/accounting/invoices`                          | Register + filters + downloads             | `invoices`      |
| `/accounting/invoices/[invoiceId]`              | Snapshot detail, VOID treatment            | `invoices`      |
| `/accounting/ledger`                            | Grouped journals                           | `ledger`        |
| `/admin/users`                                  | Users table + role/status dialogs          | `users`         |
| `/admin/audit-log`                              | Append-only trail + details sheet          | `audit`         |

### API route handlers

| Handler                             | Auth                    | Purpose                                                  |
| ----------------------------------- | ----------------------- | -------------------------------------------------------- |
| `GET /api/invoices/[invoiceId]/pdf` | Admin/Sales             | Streams generated PDF (`%PDF-`, safe filename, no-store) |
| `GET /api/audit-log/[id]`           | Admin                   | Sanitized detail JSON for the sheet                      |
| `POST /api/demo-seed`               | Dev-only (+Admin/Sales) | Idempotent demo bootstrap; 404 in production             |
| `GET /api/health`                   | Public                  | env/database/pdf checks; 503 unhealthy                   |

Root files: `error.tsx` / `global-error.tsx` / `not-found.tsx` provide the
error/404 states; `proxy.ts` at the src root handles session-based route
protection.

---

## Shared components

### `src/components/shared/`

| Component                             | What it does                                                        | Used by                                                     |
| ------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------- |
| `data-table/data-table.tsx`           | Accessible sortable table (column helper, aria sort)                | All registers: products, orders, customers, invoices, audit |
| `data-table-pagination.tsx`           | URL-driven pagination                                               | Same grids                                                  |
| `data-table-toolbar.tsx`              | Filter/search row scaffolding                                       | Grids with search                                           |
| `data-table-skeleton.tsx`             | Suspense fallback matching table layout                             | List pages                                                  |
| `searchable-combobox.tsx`             | Keyboard-accessible typeahead (arrow/enter)                         | Wizard customer/product pickers                             |
| `form-controls.tsx`                   | Labeled field wrapper (input/select/textarea + errors)              | All forms                                                   |
| `inputs.tsx`                          | Raw styled inputs                                                   | Forms                                                       |
| `form-error-summary.tsx`              | Focusable summary of validation failures                            | Customer/product/order forms                                |
| `action-error-alert.tsx`              | Typed server-action failure display (conflict/recovery affordances) | Status-action dialogs, forms                                |
| `display.tsx` (`Money`, `EmptyState`) | Cents formatter + empty/filtered states                             | Everywhere money or empties appear                          |
| `status-badge.tsx`                    | Consistent status → badge styling                                   | Orders, invoices, products                                  |
| `breadcrumbs.tsx`                     | Trail back to section roots                                         | Detail/edit pages                                           |
| `forbidden-access.tsx`                | 403 content                                                         | Section layouts on role denial                              |
| `user-menu.tsx`                       | Identity + sign-out dropdown                                        | Dashboard shell                                             |
| `mobile-nav.tsx`                      | Sheet nav under desktop breakpoint                                  | Dashboard shell                                             |

### `src/components/ui/`

shadcn/Radix primitives — button, input, label, textarea, checkbox, card,
badge, alert, dialog, sheet, dropdown-menu, avatar, breadcrumb, separator,
skeleton, table, tooltip. Treat as design-system vocabulary; compose rather
than restyle.

---

## `src/lib/` — cross-cutting infrastructure

| Module                                        | Exports                                                      | Notes                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `lib/auth/roles.ts`                           | `ROLE_KEYS`, `MODULE_ROLE_REQUIREMENTS`, `hasAnyRole`        | Single source of the RBAC matrix; browser-safe                                                        |
| `lib/auth/current-user.ts`                    | `getCurrentUser` (cached)                                    | Joins Supabase identity → app user + roles                                                            |
| `lib/auth/guards.ts`                          | `requireUser`, `getActionContext`, `requireAnyRole`          | Every action/page entry point funnels through here                                                    |
| `lib/auth/navigation.ts`                      | `NAV_ITEMS`, `visibleNavItems`                               | Shell nav filtered by roles                                                                           |
| `lib/auth/safe-redirect.ts`                   | redirect validation                                          | Rejects non-relative/open-redirect `next` targets                                                     |
| `lib/cache/tags.ts`                           | `CACHE_TAGS`, `entityTag()`, `CACHE_LIFETIMES`               | Only sanctioned invalidation keys/namespaces                                                          |
| `lib/cache/invalidate.ts`                     | `invalidateTags`, `refreshStale`, `invalidatePath`           | Wraps `updateTag` / `revalidateTag(tag, profile)`                                                     |
| `lib/audit/events.ts`                         | `AUDIT_ACTIONS`, `AUDIT_ENTITY_TYPES`, `redactAuditMetadata` | Fixed vocabulary + redaction; browser-safe                                                            |
| `lib/audit/writer.ts`                         | `writeAuditEvent(db, event)`                                 | In-transaction append with redaction                                                                  |
| `lib/errors/*`                                | `DomainError`, `actionResult`, `mapActionError`, logging     | Typed failure codes (VALIDATION/CONFLICT/FORBIDDEN/INSUFFICIENT_STOCK…) mapped to client-safe results |
| `lib/list-query/*`                            | `parseListQuery`, canonical hrefs, LIKE escaping             | Hostile URLs degrade to defaults; search escapes `%_`                                                 |
| `lib/env/server.ts`                           | validated server env + `resetServerEnvCacheForTests`         | Fails fast on missing config                                                                          |
| `lib/money.ts`                                | cents ↔ string helpers                                       | Money is integer cents end-to-end                                                                     |
| `lib/security/headers.ts`                     | CSP/frame/referrer headers                                   | Applied globally in `next.config.ts`                                                                  |
| `lib/supabase/{client,server,admin,proxy}.ts` | Supabase clients                                             | Browser / RSC-with-cookies / secret-key admin / edge proxy variants                                   |
| `lib/utils.ts`                                | `cn()` class merge                                           | shadcn convention                                                                                     |

---

## Database (`src/db/`)

- `schema/` split by domain: `inventory.ts` (categories, products),
  `customers.ts`, `orders.ts` (+ line items), `invoices.ts`,
  `ledger.ts`, `stock-movements.ts`, `users.ts`, `auth.ts` (identity link),
  `audit.ts`, `enums.ts`, `shared.ts` (timestamps), `relations.ts`,
  barrel `index.ts`.
- Money columns are `bigint` cents; append-only tables get DB-level
  constraints/triggers (balance check, immutability); indexes match the
  documented access paths.
- `migrations/0000…0009` are applied by drizzle-kit; notable:
  `0001_auth_identity_sync.sql` (Supabase ↔ app users), `0007_ledger-audit`
  (balance trigger + audit indexes), `0009_rls-hardening.sql` (deny-by-
  default RLS, runtime role SELECT/INSERT-only on append-only tables).
- `seed.mts` maps pre-provisioned Supabase identities to app users with
  fixed roles (`pnpm db:seed`). Demo _business_ data flows through feature
  seeds instead (`*/demo-seed.ts`, composed by `pnpm db:demo`).

---

## Tests

| Suite          | Location                  | Runs against                                      | Command                                            |
| -------------- | ------------------------- | ------------------------------------------------- | -------------------------------------------------- |
| Unit/component | co-located `*.test.ts(x)` | jsdom + mocks                                     | `pnpm test`                                        |
| Integration    | `*.integration.test.ts`   | Real Postgres (`docker compose up postgres-test`) | `INTEGRATION_DATABASE_URL=… pnpm test:integration` |
| E2E            | `e2e/*.spec.ts`           | Running app (dev or prod build)                   | `pnpm test:e2e`                                    |

- `vitest.config.ts` aliases `@` and stubs `server-only` (see
  `test/stubs/server-only.ts`); integration config keeps it real.
- `test/factories/db.ts` creates/destroys the disposable database;
  `test/factories/factories.ts` makes auth users + role assignments.
- Naming conventions worth knowing: `*.a11y.test.tsx` (jest-axe),
  `actions.invalidation.test.ts` (cache-tag matrix),
  `*.rbac.integration.test.ts` (denial proofs).

## Conventions cheat-sheet

1. New domain? Create `src/features/<name>/` with the standard five files
   before touching `src/app`.
2. Pages never query the DB directly — they call feature queries inside
   Suspense and pass serializable props down.
3. Mutations always go through an `actions.ts` entry point so validation,
   authorization, transactions, auditing, and invalidation happen in one
   reviewed place.
4. Cache reads must declare tags from `CACHE_TAGS`; mutations must
   invalidate exactly the documented set (pinned by
   `orders/actions.invalidation.test.ts`).
5. Roles come only from the server (`getActionContext`); anything
   role-shaped received from the client is untrusted.
