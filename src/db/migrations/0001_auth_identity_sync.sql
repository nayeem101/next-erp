-- Hardened Supabase Auth identity synchronization.
--
-- Mirrors every auth.users identity into public.users and keeps email and
-- display-name fields synchronized after relevant Auth updates. The function
-- is SECURITY DEFINER with an empty search_path, fully qualifies every
-- object, and NEVER assigns a role: a newly provisioned identity cannot
-- enter the application until an Admin grants at least one role.

CREATE OR REPLACE FUNCTION public.sync_auth_user_to_public_users()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text;
  v_metadata jsonb;
  v_display_name text;
BEGIN
  v_email := NULLIF(btrim(NEW.email), '');

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Auth identity % cannot sync without a nonblank email', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  v_metadata := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);

  v_display_name :=
    CASE
      WHEN jsonb_typeof(v_metadata -> 'display_name') = 'string'
        THEN v_metadata ->> 'display_name'
      WHEN jsonb_typeof(v_metadata -> 'full_name') = 'string'
        THEN v_metadata ->> 'full_name'
      WHEN jsonb_typeof(v_metadata -> 'name') = 'string'
        THEN v_metadata ->> 'name'
      ELSE NULL
    END;

  v_display_name := btrim(
    regexp_replace(COALESCE(v_display_name, ''), '\s+', ' ', 'g')
  );

  IF v_display_name = '' THEN
    v_display_name := split_part(v_email, '@', 1);
  END IF;

  INSERT INTO public.users AS existing_user (id, email, display_name)
  VALUES (NEW.id, v_email, left(v_display_name, 120))
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_identity_synced ON auth.users;

CREATE TRIGGER on_auth_identity_synced
AFTER INSERT OR UPDATE OF email, raw_user_meta_data
ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_auth_user_to_public_users();

-- Trigger functions do not need EXECUTE privileges to fire; direct calls are
-- denied to every caller including the browser-facing roles.
REVOKE EXECUTE ON FUNCTION public.sync_auth_user_to_public_users() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.sync_auth_user_to_public_users() FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.sync_auth_user_to_public_users() FROM authenticated';
  END IF;
END;
$$;
