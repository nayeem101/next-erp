# Phase 7 release review

Concrete evidence for the pre-deployment review tasks. Each section states
what was checked, how, and where the proof lives.

## Security review

| Area                  | Finding                                                                                                                                                                         | Evidence                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Secrets               | All credentials via environment only; `.env.example` holds placeholders; no secret is logged (redaction strips credential-shaped keys)                                          | `src/lib/audit/events.ts`, `pnpm lint` clean                      |
| Auth/session trust    | Sessions verified server-side against Supabase (`getUser` + app-role join); browser never asserts roles; cached dashboard functions accept only serializable range/variant args | `src/lib/auth/guards.ts`, `dashboard.queries.integration.test.ts` |
| Role/action bypass    | Every action guarded by `MODULE_ROLE_REQUIREMENTS`; per-feature RBAC integration tests prove denials (products, invoices PDF, audit detail, ledger layout)                      | `*.rbac.integration.test.ts`, `route.test.ts` suites              |
| Open redirects        | Login accepts `next` only as same-origin relative path                                                                                                                          | `docs/API_SPEC.md` login contract, auth tests                     |
| SQL injection         | All filters parameterized through Drizzle `sql` templates or query builders; list columns allowlisted                                                                           | `ledger/queries.ts`, `audit/queries.ts`, `list-query/parse`       |
| Headers               | CSP, `X-Frame-Options: DENY`, `Referrer-Policy` applied globally                                                                                                                | `next.config.ts`, `src/lib/security/headers.ts`                   |
| Append-only integrity | RLS grants runtime role SELECT/INSERT only on ledger/audit/movements; UPDATE/DELETE rejected at DB level                                                                        | `0009_rls-hardening.sql`, `audit.queries.integration.test.ts`     |
| PDF authorization     | Inventory/anonymous denied 403 before existence checks; malformed ids 404 without leaking existence                                                                             | `api/invoices/[id]/pdf/route.test.ts`                             |

## Performance review

- **Dashboard streaming:** widgets render under independent Suspense
  boundaries; a streaming smoke proves shell/fast siblings flush before a
  slow aggregate resolves (`widgets.streaming.test.tsx`). List queries bound
  page size (max 50) and use keyset-friendly ordering.
- **Query plans / indexes:** verified `pg_indexes` covers every hot path —
  `ledger_entries(created_at)`, `(journal_id, account)`;
  `stock_movements(product_id, created_at)`, `(order_id)`;
  `products(stock_on_hand, reorder_level) WHERE is_active`; `orders(status,
created_at)`; `audit_log(action)`, `(actor_user_id, created_at)`,
  `(entity_type, entity_id)`. Planners choose seq scans on empty test tables
  (expected); index definitions match plan needs at data volumes.
- **Client bundles:** chart rendering is isolated in the Recharts client
  component loaded only by the revenue widget; grids/pagination stay URL-
  driven with server navigation, no TanStack Query cache.

## Keyboard and accessibility review

- axe suites green across forms/grids/wizard/invoice/dashboard/audit
  (`*.a11y.test.tsx`), including both top-products projections.
- Keyboard behavior unit-tested for searchable comboboxes (arrow/enter),
  form controls, and wizard step navigation (`form-controls.test.tsx`,
  `searchable-combobox.test.tsx`, wizard tests).
- Shell provides skip link, semantic landmarks, active nav state; sheets and
  dialogs expose accessible names/descriptions (audit sheet asserted).

## Responsive review

Playwright config runs every spec on desktop Chromium **and** mobile
Chromium (Pixel 7 viewport), so layout regressions at phone widths fail CI.
Dashboard grid collapses to one column below `lg`; tables scroll within
cards. Focus rings preserved by shared button/input variants.

## Cache invalidation parity

Verified against the ARCHITECTURE matrix with pinned expectations in
`actions.invalidation.test.ts`: draft mutations touch recent-orders only;
confirm/cancelled-cancel invalidate all four dashboard tags plus order/
customer entity tags and products/invoices/ledger; fulfill touches
recent-orders without revenue tags; product/stock mutations touch
dashboard:low-stock. No user-specific data enters shared caches (variants
are server-derived; invoice detail and drafts are uncached).

## Environment-bound items

The following require external accounts and cannot execute in this
workspace; runbooks and hooks are ready:

- Full Playwright suite against a Vercel preview:
  `PLAYWRIGHT_BASE_URL=https://<preview> E2E_ADMIN_EMAIL=... pnpm test:e2e`.
- Tag/deploy execution after gates pass locally (see DEPLOYMENT.md).
