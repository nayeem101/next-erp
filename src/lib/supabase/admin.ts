import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/env/server";

export function createAdminClient() {
  const env = getServerEnv();

  return createSupabaseClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SECRET_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
