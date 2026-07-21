import {
  formatEnvIssues,
  publicEnvSchema,
  type PublicEnv,
} from "@/lib/env/schemas";

let cachedPublicEnv: PublicEnv | undefined;

function readPublicEnvSource(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

export function getPublicEnv(): PublicEnv {
  if (cachedPublicEnv) {
    return cachedPublicEnv;
  }

  const parsed = publicEnvSchema.safeParse(readPublicEnvSource());

  if (!parsed.success) {
    throw new Error(
      `Invalid public environment configuration:\n${formatEnvIssues(parsed.error)}`,
    );
  }

  cachedPublicEnv = parsed.data;
  return cachedPublicEnv;
}

export function resetPublicEnvCacheForTests(): void {
  cachedPublicEnv = undefined;
}
