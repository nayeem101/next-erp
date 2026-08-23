/**
 * Idempotent development/demo seed (Phase 1 scope).
 *
 * Seeds exactly the fixed role rows and maps pre-provisioned Supabase Auth
 * identities onto application users with fixed role assignments. Transactional
 * demo data (categories, products, customers, orders) belongs to the feature
 * phases that own those services and is intentionally not seeded here.
 *
 * Run with: pnpm db:seed
 * Requires Node.js >= 22.6 (native TypeScript type stripping).
 */

import { existsSync, readFileSync } from "node:fs";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";

import postgres from "postgres";
import { z } from "zod";

const seedEnvSchema = z.object({
  SEED_DEMO_ADMIN_ID: z.string().uuid(),
  SEED_DEMO_SALES_ID: z.string().uuid(),
  SEED_DEMO_INVENTORY_ID: z.string().uuid(),
});

export interface SeedEnvironment {
  databaseUrl: string;
  adminId: string;
  salesId: string;
  inventoryId: string;
}

const FIXED_ROLES = [
  {
    key: "admin",
    name: "Administrator",
    description: "Full access across every module including users and ledger.",
  },
  {
    key: "sales",
    name: "Sales",
    description: "Manages customers, orders, and invoices.",
  },
  {
    key: "inventory",
    name: "Inventory",
    description: "Manages catalog and stock movements.",
  },
] as const;

export function parseSeedEnvironment(
  source: Record<string, string | undefined>,
  fallbackDatabaseUrl?: string,
): SeedEnvironment {
  const parsed = seedEnvSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Invalid seed environment:\n${details}\n\nProvision the demo identities in Supabase Auth first, then export their UUIDs.`,
    );
  }

  return {
    databaseUrl: fallbackDatabaseUrl ?? "",
    adminId: parsed.data.SEED_DEMO_ADMIN_ID,
    salesId: parsed.data.SEED_DEMO_SALES_ID,
    inventoryId: parsed.data.SEED_DEMO_INVENTORY_ID,
  };
}

/**
 * Applies the Phase 1 seed. Safe to run repeatedly: role rows conflict on key,
 * application-user rows are ensured from the provisioned auth identities, and
 * role assignments conflict on (user_id, role_id).
 */
export async function seedDevelopmentData(
  sql: ReturnType<typeof postgres>,
  environment: Pick<SeedEnvironment, "adminId" | "salesId" | "inventoryId">,
): Promise<void> {
  await sql.begin(async (tx) => {
    // Fail loudly with an actionable message when an ID was not provisioned.
    const provisioned = (await tx`
      select id from auth.users
      where id in (
        ${environment.adminId}::uuid,
        ${environment.salesId}::uuid,
        ${environment.inventoryId}::uuid
      )
    `) as Array<{ id: string }>;

    const provisionedIds = new Set(provisioned.map((row) => row.id));

    for (const [label, id] of [
      ["SEED_DEMO_ADMIN_ID", environment.adminId],
      ["SEED_DEMO_SALES_ID", environment.salesId],
      ["SEED_DEMO_INVENTORY_ID", environment.inventoryId],
    ] as const) {
      if (!provisionedIds.has(id)) {
        throw new Error(
          `No Supabase Auth identity exists for ${label} (${id}). Provision it before seeding.`,
        );
      }
    }

    await tx`
      insert into public.roles (key, name, description)
      select r.key::role_key, r.name, r.description
      from jsonb_to_recordset(${tx.json(FIXED_ROLES)})
        as r(key text, name text, description text)
      on conflict (key) do nothing
    `;

    // Ensures application users exist even if identities were provisioned
    // before the synchronization trigger was installed.
    await tx`
      insert into public.users (id, email, display_name)
      select a.id, coalesce(btrim(a.email), 'unknown@example.com'),
        coalesce(
          nullif(btrim(a.raw_user_meta_data ->> 'display_name'), ''),
          split_part(coalesce(btrim(a.email), 'unknown'), '@', 1)
        )
      from (values
        (${environment.adminId}::uuid),
        (${environment.salesId}::uuid),
        (${environment.inventoryId}::uuid)
      ) as mapped(id)
      join auth.users a on a.id = mapped.id
      on conflict (id) do nothing
    `;

    const roleIdRows = (await tx`
      select key, id from public.roles
    `) as Array<{ key: string; id: string }>;

    const roleIds = new Map(roleIdRows.map((row) => [row.key, row.id]));

    const assignments: Array<{ userId: string; roleId: string }> = [
      { userId: environment.adminId, roleId: roleIds.get("admin") ?? "" },
      { userId: environment.adminId, roleId: roleIds.get("sales") ?? "" },
      { userId: environment.adminId, roleId: roleIds.get("inventory") ?? "" },
      { userId: environment.salesId, roleId: roleIds.get("sales") ?? "" },
      {
        userId: environment.inventoryId,
        roleId: roleIds.get("inventory") ?? "",
      },
    ];

    for (const assignment of assignments) {
      if (!assignment.roleId) {
        throw new Error("fixed role row missing after seeding");
      }

      await tx`
        insert into public.user_roles (user_id, role_id)
        values (${assignment.userId}::uuid, ${assignment.roleId}::uuid)
        on conflict (user_id, role_id) do nothing
      `;
    }
  });
}

function loadDotEnv(path: string): void {
  if (!existsSync(path)) {
    return;
  }

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);

    if (!match) {
      continue;
    }

    const [fullMatch, key, rawValue] = match;

    if (
      !fullMatch ||
      !key ||
      rawValue === undefined ||
      process.env[key] !== undefined
    ) {
      continue;
    }

    let value = rawValue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

async function main(): Promise<void> {
  loadDotEnv(new URL("../.env.local", import.meta.url).pathname);

  const databaseUrl =
    process.env.DATABASE_URL ?? process.env.INTEGRATION_DATABASE_URL;

  if (!databaseUrl) {
    console.error("Set DATABASE_URL before running the seed.");
    exit(1);
  }

  const environment = parseSeedEnvironment(process.env);

  const sql = postgres(databaseUrl, { max: 1 });

  try {
    await seedDevelopmentData(sql, environment);
    console.log("Phase 1 seed applied: fixed roles and demo user mapping.");
  } finally {
    await sql.end();
  }
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    exit(1);
  });
}
