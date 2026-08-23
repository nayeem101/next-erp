import { pgSchema, uuid } from "drizzle-orm/pg-core";

export const authSchema = pgSchema("auth");

/**
 * Read-only declaration of the Supabase-owned identity table.
 *
 * Drizzle migrations manage only the public schema; this declaration exists so
 * `public.users` can reference the external `auth.users` primary key.
 */
export const authUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
});
