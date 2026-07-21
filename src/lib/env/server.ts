import "server-only";

import {
  formatEnvIssues,
  serverEnvSchema,
  toSellerIdentity,
  type SellerIdentity,
  type ServerEnv,
} from "@/lib/env/schemas";

let cachedServerEnv: ServerEnv | undefined;

function readServerEnvSource(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    DATABASE_URL: process.env.DATABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    COMPANY_NAME: process.env.COMPANY_NAME,
    COMPANY_EMAIL: process.env.COMPANY_EMAIL,
    COMPANY_ADDRESS_LINE_1: process.env.COMPANY_ADDRESS_LINE_1,
    COMPANY_ADDRESS_LINE_2: process.env.COMPANY_ADDRESS_LINE_2,
    COMPANY_CITY: process.env.COMPANY_CITY,
    COMPANY_REGION: process.env.COMPANY_REGION,
    COMPANY_POSTAL_CODE: process.env.COMPANY_POSTAL_CODE,
    COMPANY_COUNTRY_CODE: process.env.COMPANY_COUNTRY_CODE,
  };
}

export function getServerEnv(): ServerEnv {
  if (cachedServerEnv) {
    return cachedServerEnv;
  }

  const parsed = serverEnvSchema.safeParse(readServerEnvSource());

  if (!parsed.success) {
    throw new Error(
      `Invalid server environment configuration:\n${formatEnvIssues(parsed.error)}`,
    );
  }

  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}

export function getSellerIdentity(
  env: ServerEnv = getServerEnv(),
): SellerIdentity {
  return toSellerIdentity(env);
}

export function resetServerEnvCacheForTests(): void {
  cachedServerEnv = undefined;
}
