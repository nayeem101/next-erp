# Supabase and Deployment Guide

## Supabase setup

### Local vs hosted

- **Local:** `npx supabase start` or point `DATABASE_URL` at any Postgres 16+
  instance. Apply migrations with `pnpm db:migrate` (drizzle-kit reads
  `src/db/migrations`).
- **Hosted (Supabase):** apply the same migrations from your machine using
  `DATABASE_URL` values from **Project Settings → Database**. Prefer the
  session-pooler connection string for migrations over direct IPv5/IPv4.

```bash
pnpm db:migrate
```

### Roles

The application never connects as `postgres`. Migrations install two
dedicated roles:

| Role               | Purpose                                      | Privileges                                                                                                                 |
| ------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `nexterp_runtime`  | The role `DATABASE_URL` uses at request time | SELECT/INSERT on app tables; **no UPDATE/DELETE on append-only tables** (`ledger_entries`, `audit_log`, `stock_movements`) |
| `nexterp_migrator` | Owned by migration tooling                   | DDL on the public schema                                                                                                   |

Row Level Security is enabled with deny-by-default policies; browser roles
(`anon`, `authenticated`) hold no object privileges on application tables —
all data access flows through the server runtime role. Verify with:

```sql
select * from pg_policies where schemaname = 'public';
\du  -- in psql: inspect role memberships
```

### Auth redirect URLs

In Supabase Dashboard → Authentication → URL Configuration:

- Site URL: your production origin (for example `https://your-app.vercel.app`).
- Redirect URLs: add each environment origin exactly once — production,
  preview pattern (`https://*-your-team.vercel.app`), and
  `http://localhost:3000` for local development.
- Never add an origin you do not control; open-redirect protection also
  rejects non-relative `next` targets at login, but keep the allowlist tight.

## Vercel configuration

Environment variables (Project → Settings → Environment Variables):

| Variable                               | Environments | Notes                                                          |
| -------------------------------------- | ------------ | -------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | all          | Project URL                                                    |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | all          | Publishable key only                                           |
| `SUPABASE_SECRET_KEY`                  | all          | Server-side auth verification; **never exposed to the client** |
| `DATABASE_URL`                         | all          | Runtime connection string using `nexterp_runtime`              |
| `COMPANY_*`                            | all          | Invoice seller identity snapshot fields                        |
| `HEALTH_PROBE_TOKEN`                   | production   | Optional; gates the deep PDF health check                      |

Privileged credentials (secret keys, database passwords) are set through the
Vercel dashboard or CLI with `--environment production` — they are never
committed, logged, or echoed. Preview deployments inherit non-secret
variables only; connect previews to a staging database if you need them
functional.

Deploy: push to the connected Git branch. `pnpm build` runs automatically;
Cache Components and PPR are enabled in `next.config.ts`.

## Health probes

`GET /api/health` is unauthenticated and returns per-check statuses:

- `env`: required environment parses.
- `database`: `SELECT 1` against the runtime role.
- `pdf` (optional): pass `?deep=1` with header `x-probe-token:
$HEALTH_PROBE_TOKEN` to render a tiny PDF and verify the renderer works
  in the deployed runtime.

Configure uptime monitoring against `/api/health`; use the deep probe after
deployments (not on every tick — rendering costs memory).

## Backup and reset cautions

- Backups via Supabase handle the whole database including append-only
  trails. Do not attempt "cleanup" deletes of `audit_log` or
  `ledger_entries` — the schema forbids it and partial restores break
  journal balance.
- Resetting local/demo environments: recreate the disposable test database
  (`pnpm db:test:start` + `pnpm db:test:bootstrap`) rather than truncating
  production-like data.
- Restoring into a fresh project requires re-running migrations first,
  then data import, then re-provisioning Auth identities so user UUIDs
  match `users.id` references (audit rows reference actor UUIDs with
  `on delete set null`).
