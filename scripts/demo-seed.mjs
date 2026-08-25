#!/usr/bin/env node
/**
 * Full idempotent demo seed (Phase 7).
 *
 * Composes every feature seed — role users, demo customers, the inventory
 * catalog, and lifecycle-varied orders — into one command by signing in as
 * the provisioned demo Admin through Supabase Auth and calling the
 * dev-only `POST /api/demo-seed` route. All writes flow through the
 * production services, so invoices, movements, journals, and audits are
 * exactly what real usage produces, and repeated runs converge (the route
 * checks existence before seeding).
 *
 * Usage:
 *   pnpm db:demo                       # against a running `pnpm dev` server
 *   DEMO_BASE_URL=https://preview... pnpm db:demo
 *
 * Required environment:
 *   NEXT_PUBLIC_SUPABASE_URL            Supabase project URL
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  publishable (anon) key
 *   DEMO_ADMIN_EMAIL / DEMO_ADMIN_PASSWORD  seeded admin identity
 *                                         (E2E_ADMIN_* also accepted)
 *
 * Credentials must never be committed; supply them via your shell or a
 * git-ignored `.env.local`.
 */

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`[db:demo] Missing ${key}.`);
    process.exit(1);
  }
}

const email = process.env.DEMO_ADMIN_EMAIL ?? process.env.E2E_ADMIN_EMAIL ?? "";
const password =
  process.env.DEMO_ADMIN_PASSWORD ?? process.env.E2E_ADMIN_PASSWORD ?? "";

if (!email || !password) {
  console.error(
    "[db:demo] Provide DEMO_ADMIN_EMAIL and DEMO_ADMIN_PASSWORD for a provisioned admin identity.",
  );
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const baseUrl = (process.env.DEMO_BASE_URL ?? "http://127.0.0.1:3100").replace(
  /\/$/,
  "",
);

async function main() {
  // 1. Sign in through Supabase Auth (password grant) to prove the
  //    identity is real; the app session itself stays cookie-based.
  const authResponse = await fetch(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: publishableKey,
      },
      body: JSON.stringify({ email, password }),
    },
  );

  if (!authResponse.ok) {
    console.error(
      `[db:demo] Sign-in failed (${String(authResponse.status)}). Check the admin credentials.`,
    );
    process.exit(1);
  }

  const session = await authResponse.json();
  const accessToken = session.access_token;

  if (typeof accessToken !== "string" || accessToken === "") {
    console.error("[db:demo] Auth response did not include an access token.");
    process.exit(1);
  }

  // 2. Trigger the idempotent seed inside the Next.js runtime.
  const seedResponse = await fetch(`${baseUrl}/api/demo-seed`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      apikey: publishableKey,
    },
  });

  if (!seedResponse.ok) {
    console.error(
      `[db:demo] Seed failed (${String(seedResponse.status)}):`,
      await seedResponse.text(),
    );
    process.exit(1);
  }

  const result = await seedResponse.json();

  console.log("[db:demo] Demo data ready:", JSON.stringify(result));
}

main().catch((error) => {
  console.error("[db:demo] Unexpected failure:", error);
  process.exit(1);
});
