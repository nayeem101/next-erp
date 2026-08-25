# End-to-end test environment

Playwright owns the local Next.js development-server lifecycle by default.

- `PLAYWRIGHT_PORT` optionally selects the local port; it defaults to `3100` and must be between `1024` and `65535`.
- `PLAYWRIGHT_BASE_URL` targets an already-running local, preview, or deployed HTTP(S) server. When set, Playwright does not start or stop a server.
- `CI` enables two retries, one worker, the GitHub reporter, and forbids committed focused tests.

## Authentication coverage

`e2e/auth.spec.ts` exercises the login experience. Anonymous flows (protected-route
redirects, `next` encoding, invalid-credential messaging) always run against the
configured Supabase project.

Authenticated flows require a seeded identity in the target project:

- `E2E_ADMIN_EMAIL` + `E2E_ADMIN_PASSWORD`: an active admin account provisioned in
  Supabase Auth with the `admin` role assigned.
- `E2E_SALES_EMAIL` + `E2E_SALES_PASSWORD`: an active sales account. Enables the
  end-to-end order flow (customer, wizard, confirm, invoice, PDF download).
- `E2E_INVENTORY_EMAIL` + `E2E_INVENTORY_PASSWORD`: an active inventory account.
  Enables the fulfill-without-revenue flow and invoice/ledger denial checks.

All authenticated flows bootstrap idempotent demo data through
`POST /api/demo-seed` (dev servers only).

When both variables are set, the suite covers sign-in success, deep-link return via
`next`, account-menu identity, sign-out re-protection, and the authenticated bounce
away from `/login`. When absent, those tests skip so fresh checkouts stay green.
Credentials must remain outside Git and must never reuse production accounts.
