-- Test-database-only bootstrap that mimics the subset of Supabase's auth
-- schema required by public-schema migrations and integration tests.
--
-- NEVER apply this against a real Supabase project: auth.users is owned by
-- Supabase Auth and must never be created or altered by this repository.

CREATE SCHEMA IF NOT EXISTS auth;

-- Mirror the Supabase browser roles so RLS behavior matches a hosted project.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email varchar(255),
  encrypted_password varchar(255),
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb NOT NULL,
  raw_app_meta_data jsonb DEFAULT '{}'::jsonb NOT NULL,
  last_sign_in_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
