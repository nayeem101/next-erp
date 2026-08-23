"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Signs the current session out and returns to the login page.
 *
 * Sign-out is best-effort: even if Auth reports an error the local cookies
 * are cleared by `@supabase/ssr`, so the user always lands on `/login`.
 */
export async function signOut(): Promise<never> {
  const supabase = await createClient();

  await supabase.auth.signOut();

  redirect("/login");
}
