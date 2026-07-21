# NextERP Architecture

## Decision summary

- Next.js 16.x App Router with React 19.2+ and TypeScript strict mode.
- Supabase Auth directly, not Auth.js.
- Supabase Postgres accessed only from server code through Drizzle ORM.
- React Server Components (RSC) for pages, reads, and composition; small Client Component islands for interaction.
- Server Actions for mutations; one PDF route handler for streamed binary output.
- Feature-oriented code organization with schemas, queries, services, actions, and UI kept near their domain.
- PostgreSQL transactions enforce cross-module workflows.
- URL search parameters own shareable table state; Zustand is limited to unsaved order-wizard state.

## Why Supabase Auth directly

Supabase Auth is the cleaner fit for this application:

- It supplies the required authentication system without adding an Auth.js session and adapter layer on top of the same Supabase project.
- `@supabase/ssr` supports cookie-based sessions in Next.js Proxy, RSC, Server Actions, and route handlers.
- `supabase.auth.getUser()` validates the access token with the Auth server and is suitable for authorization boundaries; `getSession()` alone is not trusted for authorization.
- The authenticated Supabase UUID maps directly to `public.users.id`, which references `auth.users.id`.
- A hardened Auth trigger mirrors newly provisioned identities into `public.users` without assigning access; Admin role assignment is still required.
- Role membership remains application-owned in Drizzle-managed Postgres tables and is checked server-side.

The browser client is used only for authentication operations that require it in future and for stretch Realtime. MVP data never travels directly from the browser to Postgres. The Supabase service-role key is not used by application pages or actions. Server-only Drizzle connects through Supabase's pooler with a restricted application database credential and `prepare: false`.

## High-level architecture

```text
┌──────────────────────────────── Browser ────────────────────────────────┐
│ Server-rendered HTML/RSC payload                                        │
│ Client islands: forms, TanStack tables, order wizard, charts, toasts    │
└───────────────────────┬──────────────────────┬───────────────────────────┘
                        │ navigation / reads   │ Server Action / PDF GET
                        v                      v
┌──────────────────────────── Vercel / Next.js ───────────────────────────┐
│ proxy.ts: refresh auth cookie + coarse protected-route redirect         │
│                                                                         │
│ App Router                                                              │
│  RSC pages/layouts ──> auth + role guard ──> feature queries             │
│  Server Actions ────> auth + role guard ──> Zod ──> domain services      │
│  PDF Route Handler ──> auth + role guard ──> @react-pdf/renderer         │
│                                      │                                  │
│  Drizzle schemas/repositories <──────┘                                  │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ TLS, pooled PostgreSQL connection
                                v
┌────────────────────────────── Supabase ─────────────────────────────────┐
│ Auth: identities, password sessions, token verification                 │
│ Postgres: app data, constraints, transactions, sequences, RLS defense   │
│ Storage: reserved for future persisted assets (not needed for MVP PDF)   │
│ Realtime: disabled until stretch scope                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Runtime boundaries

### Server Components by default

Pages and layouts remain Server Components unless they need hooks, event handlers, browser APIs, or a client-only library. Server Components authenticate before reading, call Drizzle queries directly, and pass minimal serializable props into client islands.

Concrete RSC examples:

1. `app/(dashboard)/inventory/products/page.tsx` authenticates the request, reads filters from `searchParams`, queries one page of products, and renders the page shell. It is server-owned because the initial data and authorization do not require browser state.
2. `app/(dashboard)/sales/orders/[orderId]/page.tsx` loads an order aggregate and invoice summary. Rendering it on the server keeps database access and permissions out of the client.
3. Dashboard widget components such as `RevenueChartWidget` and `LowStockWidget` independently fetch their data on the server and are wrapped in Suspense. The chart's visual renderer is a nested Client Component because Recharts requires the browser.

### Client Components as narrow islands

Concrete Client Component examples:

1. `DataTable` uses TanStack Table for column visibility, interactive sorting controls, row selection, and filter inputs. Data loading remains server-owned; table controls update URL search parameters and trigger navigation.
2. `ProductForm` and `CustomerForm` use React Hook Form, a shared Zod resolver, pending state, and accessible field errors. They invoke Server Actions but do not query the database.
3. `OrderWizard` uses Zustand for unsaved, cross-step selections and line items. Its store is created per mounted wizard, is not persisted globally, and is cleared after a successful save/confirm. Server validation and current prices/stock remain authoritative.

`"use client"` is placed at the smallest practical boundary. A client component does not make all imported visual children client components unless those imports cross that boundary, so server-fetched data is passed as plain props to focused interactive components.

## Request and mutation data flow

### Read flow

```text
request
  → Proxy refreshes Supabase session and performs coarse redirect
  → protected layout calls requireUser()/requireRole()
  → page parses URL search params with Zod
  → feature query runs through Drizzle
  → RSC renders data
  → serialized rows/config passed to interactive table/chart island
```

Feature queries never accept a user ID or role supplied by the browser. Authorization context comes from the verified server session.

### Mutation flow

```text
React Hook Form
  → shared Zod schema (fast client feedback)
  → Server Action(form/input)
  → requireUser() + requireRole() (never trust hidden fields)
  → same Zod schema.safeParse() (authoritative validation)
  → domain service
  → Drizzle transaction / constrained SQL
  → Postgres
  → typed ActionResult returned
  → updateTag() and revalidatePath() after commit
  → client displays result and router refresh/navigation
```

Actions are thin adapters. Business rules live in server-only domain services so they can be integration-tested without React. The order confirmation service performs stock checks/deductions, order transition, invoice creation, ledger postings, and audit insertion in one database transaction.

Expected failures return typed results:

```ts
type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: ActionErrorCode;
        message: string;
        fieldErrors?: Record<string, string[]>;
      };
    };
```

Unexpected exceptions are logged server-side with a request/correlation ID and mapped to `INTERNAL_ERROR`; stack traces and database details are never returned to the browser.

## Authentication and authorization

Authorization is defense in depth:

### Next.js Proxy: session continuity and coarse access

- Runs on application routes, excluding static assets and Next internals.
- Refreshes expired Supabase cookies using `@supabase/ssr`.
- Redirects unauthenticated protected-route requests to `/login?next=<safe-path>`.
- Redirects an authenticated user away from `/login`.
- Uses the Next.js 16 `proxy.ts` convention and exported `proxy` function on the Node.js runtime.
- Does not make final role decisions. Proxy database lookups add latency and cookie claims may be stale after a role change.

### Protected dashboard layout: verified identity and navigation

- Calls `getUser()` through a server Supabase client.
- Loads `public.users` and role memberships through Drizzle.
- Rejects disabled or unprovisioned users.
- Supplies a minimal `CurrentUser` object to the shell and builds role-aware navigation.
- Module layouts call `requireAnyRole()`:
  - `/inventory`: Admin or Inventory; Sales reaches product availability through the order UI rather than inventory administration pages.
  - `/customers`: Admin or Sales.
  - `/sales/orders`: Admin, Sales, or Inventory, with page/action differences.
  - `/accounting/invoices`: Admin or Sales.
  - `/accounting/ledger`: Admin only.
  - `/admin`: Admin only.

### Page/query guards: data visibility

- Pages with mixed-role access request only allowed projections.
- Inventory users can view order contact/shipping details needed for fulfillment but not invoices, revenue, or ledger data.
- Dashboard widget queries check their required role independently so widgets cannot be invoked as unguarded server functions.

### Server Action and route-handler guards: final authority

- Every action begins with `requireUser()` and `requireAnyRole()`.
- Entity state and ownership/context are loaded from the database; browser-submitted status, totals, prices, and actor IDs are ignored.
- The PDF handler verifies Admin or Sales role before reading invoice data.
- Role-change actions cannot remove the last active Admin role.

### Database layer

- Application tables have RLS enabled as a fallback against accidental browser access.
- Supabase browser roles have no application-table read or write policies in MVP.
- The non-owner server runtime role has explicit least-privilege RLS policies/grants and no ability to alter schema or bypass RLS.
- Migration credentials and Supabase service-role credentials exist only in local/CI/Vercel server environments.
- Constraints and transactions remain authoritative for invariants even if an application check is missed.

## Route and folder structure

Route groups organize concerns without changing URLs:

```text
.cursor/
└─ rules/
   ├─ tech-stack.mdc       # always-on project constraints
   ├─ nextjs-app.mdc       # src TypeScript/TSX App Router rules
   └─ typescript.mdc       # TypeScript/TSX strictness rules
.cursorignore              # root-level secrets/generated exclusions
docs/                      # product and engineering source of truth
src/
├─ app/
│  ├─ (auth)/
│  │  └─ login/page.tsx
│  ├─ (dashboard)/
│  │  ├─ layout.tsx
│  │  ├─ dashboard/
│  │  │  ├─ page.tsx
│  │  │  ├─ loading.tsx
│  │  │  └─ _components/
│  │  ├─ inventory/
│  │  │  ├─ layout.tsx
│  │  │  ├─ products/{page.tsx,new/page.tsx,[productId]/page.tsx,[productId]/edit/page.tsx}
│  │  │  ├─ categories/page.tsx
│  │  │  └─ stock-movements/page.tsx
│  │  ├─ customers/
│  │  │  ├─ page.tsx
│  │  │  ├─ new/page.tsx
│  │  │  └─ [customerId]/{page.tsx,edit/page.tsx}
│  │  ├─ sales/
│  │  │  └─ orders/{page.tsx,new/page.tsx,[orderId]/page.tsx,[orderId]/edit/page.tsx}
│  │  ├─ accounting/
│  │  │  ├─ invoices/{page.tsx,[invoiceId]/page.tsx}
│  │  │  └─ ledger/page.tsx
│  │  └─ admin/
│  │     ├─ users/page.tsx
│  │     └─ audit-log/page.tsx
│  ├─ api/
│  │  └─ invoices/[invoiceId]/pdf/route.ts
│  ├─ page.tsx             # auth-aware root redirect
│  ├─ error.tsx
│  ├─ global-error.tsx
│  ├─ layout.tsx
│  └─ not-found.tsx
├─ components/
│  ├─ ui/                  # shadcn/ui generated primitives
│  ├─ data-table/
│  └─ shared/
├─ features/
│  ├─ auth/
│  ├─ users/
│  ├─ inventory/
│  ├─ customers/
│  ├─ orders/
│  ├─ invoices/
│  ├─ ledger/
│  ├─ dashboard/
│  └─ audit/
│     # each feature may contain actions.ts, schemas.ts, queries.ts,
│     # service.ts, types.ts, and components/
├─ db/
│  ├─ schema/
│  ├─ migrations/
│  ├─ index.ts
│  └─ seed.ts
├─ lib/
│  ├─ auth/
│  ├─ supabase/
│  ├─ errors/
│  ├─ env.ts
│  ├─ money.ts
│  └─ utils.ts
└─ test/
   ├─ factories/
   └─ setup.ts
e2e/
```

Private route `_components` hold composition unique to a route. Reusable domain components live under their feature. Generic, domain-neutral components live under `components`.

Cursor project conventions:

- Keep tracked project rules as focused `.mdc` files under `.cursor/rules/`, with valid `description`, `globs`, and `alwaysApply` frontmatter.
- Keep `.cursorignore` at the repository root, not inside `.cursor/`; it excludes secrets and generated/large artifacts beyond normal `.gitignore` behavior.
- Do not duplicate these rules in `AGENTS.md`.
- `.cursor/plans/` is not an official Cursor configuration convention. If a plan is intentionally saved and reviewed with the codebase, store it as ordinary documentation under `docs/plans/`.
- Add `.cursor/mcp.json`, `.cursor/hooks.json`, `.cursor/skills/`, or `.cursor/commands/` only when a concrete workflow requires them; never commit secrets in Cursor configuration.

The root `/` is a server redirect: authenticated users go to `/dashboard`; all others go to `/login`. Inventory may access `/sales/orders` and `/sales/orders/[orderId]` for its operational queue, but `/sales/orders/new` and `/sales/orders/[orderId]/edit` explicitly require Admin or Sales.

## Database and transaction architecture

- Drizzle schema is the source of truth for application tables; generated SQL migrations are committed.
- Supabase's `auth.users` table is external to Drizzle migrations. `public.users.id` references it with `ON DELETE RESTRICT` so identities with business history are disabled rather than deleted.
- IDs are UUIDs generated in Postgres. Human numbers use PostgreSQL sequences.
- Currency uses integer cents (`bigint` in Postgres, serialized to strings across RSC boundaries when needed); quantity is integer.
- Seller identity is validated from server-only `COMPANY_NAME`, `COMPANY_EMAIL`, `COMPANY_ADDRESS_LINE_1`, optional `COMPANY_ADDRESS_LINE_2`/`COMPANY_REGION`, `COMPANY_CITY`, `COMPANY_POSTAL_CODE`, and `COMPANY_COUNTRY_CODE`, then snapshotted with bill-to data on invoice creation.
- `products.stock_on_hand` is a transactional balance cache. `stock_movements` is its append-only explanation trail.
- Services lock/update product rows in deterministic product-ID order during confirm/cancel to reduce deadlock risk.
- Confirmation uses conditional updates (`stock_on_hand >= requested`) plus a non-negative check constraint. Any failed line rolls back the whole transaction.
- Ledger postings are append-only rows grouped by a `journal_id`; each sale/reversal journal is checked for balance in the service and by a deferred database constraint trigger installed by migration SQL.
- Audit records are inserted in the same transaction as the event they describe.

## Caching and revalidation

### Principles

- Next.js 16 Cache Components are enabled with `cacheComponents: true`.
- Request-time Drizzle reads are dynamic and uncached unless a safe function/component explicitly uses `"use cache"`.
- Authentication, role membership, user-specific views, order drafts, invoice detail, and audit queries are never placed in a shared cache.
- Shared catalog lookups and dashboard aggregates may use `"use cache"` with stable `cacheLife()`/`cacheTag()` APIs after authorization has already succeeded.
- Every role-varying dashboard cache key includes a projection variant (`sales`, `operations`, or `units`). Cached query functions accept that server-derived variant, never a browser-provided role. A common family tag (for example `dashboard:recent-orders`) is attached to every variant so one mutation invalidates all safe projections.
- Client tables use URL state and server navigation, not TanStack Query caches.
- Server Actions call `updateTag()` only after a successful database commit for immediate read-your-writes behavior, then `revalidatePath()` for affected route payloads.
- `revalidateTag(tag, "max")` is reserved for non-interactive invalidation such as future webhook/background processing where stale-while-revalidate is acceptable; the deprecated one-argument form is never used.

### Cache tags

| Tag                       | Data                                     |
| ------------------------- | ---------------------------------------- |
| `products`                | active product catalog and product lists |
| `product:{id}`            | one product                              |
| `categories`              | category options/lists                   |
| `customers`               | customer lists/options                   |
| `customer:{id}`           | customer detail/order summary            |
| `orders`                  | order lists and recent-order aggregate   |
| `order:{id}`              | one order aggregate                      |
| `invoices`                | invoice lists                            |
| `invoice:{id}`            | invoice detail                           |
| `ledger`                  | ledger list/aggregates                   |
| `dashboard:revenue`       | revenue series                           |
| `dashboard:top-products`  | top products                             |
| `dashboard:low-stock`     | low-stock widget                         |
| `dashboard:recent-orders` | recent orders                            |
| `audit-log`               | audit list                               |
| `users`                   | application user/role list               |

### Mutation revalidation matrix

- Category create/update/archive: `categories`, `products`; paths `/inventory/categories`, `/inventory/products`.
- Product create/update/archive: `products`, `product:{id}`, `dashboard:low-stock`; paths product list/detail.
- Stock adjustment: `products`, `product:{id}`, `dashboard:low-stock`; paths `/inventory/products`, `/inventory/stock-movements`.
- Customer create/update/archive: `customers`, `customer:{id}`; paths customer list/detail.
- Draft order create/update/cancel: `orders`, `order:{id}`, `customer:{id}`, `dashboard:recent-orders`; order and customer paths.
- Confirm order: product/order/customer/invoice/ledger/audit tags plus all four dashboard tags; relevant inventory, order, invoice, ledger, dashboard, and audit paths.
- Fulfill order: `orders`, `order:{id}`, `customer:{id}`, `dashboard:recent-orders`, `audit-log`; order paths.
- Cancel confirmed order: same breadth as confirm because stock, invoice, ledger, revenue, top products, and audit all change.
- Role assignment/user status: `users`, `audit-log`; `/admin/users` and `/admin/audit-log`.

For each Server Action, the tags listed above are expired with `updateTag`, and `revalidatePath` refreshes the listed route payloads. Explicitly cached reads declare matching tags with `cacheTag`. Broad invalidation is acceptable for MVP's dataset; tag granularity prevents unnecessary dashboard recomputation where practical.

## Streaming, loading, and errors

- The dashboard page renders its shell immediately and wraps each async widget in its own Suspense fallback.
- Each widget has a local error boundary so aggregate failure is isolated.
- Route `loading.tsx` files provide structural skeletons for navigations; form pending states remain local.
- `notFound()` handles missing or inaccessible entities where revealing existence would be undesirable.
- Expected action failures are typed. Route-level `error.tsx` handles unexpected render failures and offers retry.

## Observability and security posture

- Server logs are structured and include correlation ID, action/route name, user ID when known, and normalized error code; they exclude passwords, tokens, and full customer payloads.
- Audit logs are business/security records, not diagnostic logs.
- Environment variables are parsed once with Zod in a server-only module. Only explicitly public Supabase URL/anon key values use `NEXT_PUBLIC_`.
- Security headers include CSP suitable for Supabase/Vercel, `X-Content-Type-Options`, `Referrer-Policy`, and frame restrictions.
- Redirect targets are restricted to same-origin relative paths.
- Forms rely on same-site cookies and Next.js Server Action origin checks; mutations also authenticate and authorize every call.

## Testing architecture

- Vitest unit tests cover schemas, permission helpers, money/status logic, and pure mappers.
- React Testing Library covers interactive forms, tables, wizard steps, and action-result states.
- Database integration tests run against an isolated Postgres/Supabase-compatible test database and cover transaction invariants.
- Playwright covers login and the complete create/confirm order flow; tests use deterministic seeded users/data.
- PDF tests validate authorization, headers, and key rendered content without brittle byte-for-byte snapshots.
