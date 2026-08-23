-- Row-level security hardening.
--
-- 1. RLS is enabled on every public application table as a fallback against
--    accidental browser access. Supabase browser roles (anon/authenticated)
--    receive no policies, so direct Data API reads and writes return nothing
--    even when table grants exist.
-- 2. A dedicated non-owner runtime role receives least-privilege grants and
--    explicit permissive policies for exactly the operations the application
--    performs. Append-only tables grant SELECT/INSERT only.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexterp_runtime') THEN
    CREATE ROLE nexterp_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END;
$$;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO nexterp_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.users,
  public.user_roles,
  public.customers,
  public.categories,
  public.products,
  public.orders,
  public.order_line_items,
  public.invoices
TO nexterp_runtime;

GRANT SELECT ON public.roles TO nexterp_runtime;

GRANT SELECT, INSERT ON
  public.stock_movements,
  public.ledger_entries,
  public.audit_log
TO nexterp_runtime;

REVOKE UPDATE, DELETE ON
  public.stock_movements,
  public.ledger_entries,
  public.audit_log
FROM nexterp_runtime;

GRANT USAGE, SELECT ON SEQUENCE
  public.order_number_seq,
  public.invoice_number_seq
TO nexterp_runtime;

-- Writable tables: full row access under the runtime role; authorization is
-- enforced by the application service layer, never by browser callers.
CREATE POLICY runtime_full_access_users ON public.users
  FOR ALL TO nexterp_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_full_access_user_roles ON public.user_roles
  FOR ALL TO nexterp_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_read_roles ON public.roles
  FOR SELECT TO nexterp_runtime USING (true);
CREATE POLICY runtime_full_access_customers ON public.customers
  FOR ALL TO nexterp_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_full_access_categories ON public.categories
  FOR ALL TO nexterp_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_full_access_products ON public.products
  FOR ALL TO nexterp_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_full_access_orders ON public.orders
  FOR ALL TO nexterp_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_full_access_order_line_items ON public.order_line_items
  FOR ALL TO nexterp_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_full_access_invoices ON public.invoices
  FOR ALL TO nexterp_runtime USING (true) WITH CHECK (true);

-- Append-only trails: read and append only; no update/delete policy exists.
CREATE POLICY runtime_append_stock_movements ON public.stock_movements
  FOR SELECT TO nexterp_runtime USING (true);
CREATE POLICY runtime_insert_stock_movements ON public.stock_movements
  FOR INSERT TO nexterp_runtime WITH CHECK (true);
CREATE POLICY runtime_append_ledger_entries ON public.ledger_entries
  FOR SELECT TO nexterp_runtime USING (true);
CREATE POLICY runtime_insert_ledger_entries ON public.ledger_entries
  FOR INSERT TO nexterp_runtime WITH CHECK (true);
CREATE POLICY runtime_append_audit_log ON public.audit_log
  FOR SELECT TO nexterp_runtime USING (true);
CREATE POLICY runtime_insert_audit_log ON public.audit_log
  FOR INSERT TO nexterp_runtime WITH CHECK (true);

-- Mirror the hosted threat model: where the Supabase browser roles exist,
-- ensure they hold no object privileges on application tables or sequences.
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I',
        role_name
      );
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END;
$$;
