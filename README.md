# NextERP

A production-shaped ERP demo built on Next.js (Cache Components), Supabase
Auth, and Postgres via Drizzle. Role-scoped modules — Inventory, Customers,
Sales Orders, Invoices, Ledger, and an Admin audit trail — share one
transactional core: confirming a sale deducts stock, issues a snapshot
invoice, posts a balanced double-entry journal, and appends an immutable
audit record in a single commit.

## Why it is interesting

- **Atomic cross-module workflows.** `confirmOrder` locks the draft and
  customer rows, conditionally deducts stock, creates the invoice, writes
  the journal, and audits everything together; insufficient stock rolls the
  entire world back.
- **Append-only books.** Ledger entries and audit records are insert-only at
  the database level — updates and deletes are rejected by RLS, verified by
  tests.
- **Role-safe caching.** Dashboard aggregates are cached per server-derived
  projection (`sales` / `operations` / `units`) under family tags, so
  mutations invalidate every role's view without ever caching money where a
  non-privileged role can read it.
- **Streamed dashboard.** Each widget renders behind its own Suspense
  boundary and local error boundary; one slow or failing aggregate never
  blocks the shell or its siblings.

## Two-minute demo script

1. Sign in as the seeded Admin (`/login`).
2. **Inventory** — create a category, add a product with opening stock,
   adjust stock down to its reorder level and watch it appear on the
   dashboard's Low Stock widget.
3. **Customers** — add a customer with billing details.
4. **New order** (`/sales/orders/new`) — pick two products, set quantities,
   save the draft.
5. **Confirm** on the order detail page — review the side-effect dialog
   (stock deducted, invoice issued, journal posted), confirm.
6. **Invoices** (`/accounting/invoices`) — open the invoice, download the
   generated PDF.
7. **Ledger** (`/accounting/ledger`) — see the balanced AR/Revenue journal;
   cancel the confirmed order and watch the reversal journal appear.
8. **Dashboard** — switch date ranges; revenue, top products, low stock, and
   recent orders stream in independently. Repeat as an Inventory user to see
   the money-free operational projection.

## Architecture highlights

| Doc                                                | Contents                                         |
| -------------------------------------------------- | ------------------------------------------------ |
| [docs/PRD.md](docs/PRD.md)                         | Product scope and acceptance flows               |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)       | Module map, transactional boundaries, cache tags |
| [docs/API_SPEC.md](docs/API_SPEC.md)               | Server actions, route handlers, audit vocabulary |
| [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) | Tables, constraints, triggers, indexes           |
| [docs/UI_SPEC.md](docs/UI_SPEC.md)                 | Screens, states, accessibility contract          |
| [docs/TASKS.md](docs/TASKS.md)                     | Phase plan with gates                            |

## Local setup

Prerequisites: Node.js >= 22.6, pnpm, Docker (for the test database),
and a Supabase project (local or hosted).

```bash
pnpm install
cp .env.example .env.local        # fill in Supabase + DATABASE_URL values
pnpm db:migrate                   # apply Drizzle migrations
node src/db/migrations/rls.sql    # RLS hardening is applied by drizzle-kit as well
pnpm db:seed                      # fixed role users from SEED_DEMO_* ids
pnpm dev                          # http://localhost:3000
```

Create the three demo identities in Supabase Auth (Admin, Sales,
Inventory) whose UUIDs match `SEED_DEMO_ADMIN_ID`, `SEED_DEMO_SALES_ID`,
and `SEED_DEMO_INVENTORY_ID` from `.env.local`, then run `pnpm db:seed`.

### Demo data

With the dev server running:

```bash
DEMO_ADMIN_EMAIL=... DEMO_ADMIN_PASSWORD=... pnpm db:demo
```

This signs in through Supabase Auth and drives the idempotent
`POST /api/demo-seed` route, seeding customers, the product catalog, and
lifecycle-varied orders (draft / confirmed / fulfilled / cancelled) through
the real services. Safe to re-run any time.

## Test commands

```bash
pnpm lint            # eslint, zero warnings allowed
pnpm typecheck       # tsc --noEmit
pnpm test            # unit + component tests (vitest)
pnpm test:integration # requires INTEGRATION_DATABASE_URL (see db:test:start)
pnpm build           # production build with Cache Components
pnpm test:e2e        # Playwright; authenticated flows need E2E_* credentials
```

Integration tests use a disposable database created by
`docker compose up -d --wait postgres-test` plus `pnpm db:test:bootstrap`,
then `INTEGRATION_DATABASE_URL=postgresql://... pnpm test:integration`.

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for Vercel configuration,
Supabase redirect URLs, migration/runtime roles, health probes, and backup
cautions.
