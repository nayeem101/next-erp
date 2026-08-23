-- Lifecycle and integrity controls that exceed table-local constraints.
--
-- 1. set_updated_at(): application-supplied timestamps are never trusted.
-- 2. Order lifecycle trigger: legal transitions, actor/timestamp presence,
--    and snapshot immutability once an order leaves draft.
-- 3. Line-item guard: order lines are frozen unless the parent is a draft.
-- 4. Balanced journals: a deferred constraint trigger re-checks every
--    affected journal at commit time.
-- 5. Append-only tables reject UPDATE/DELETE outright.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'users',
    'customers',
    'categories',
    'products',
    'orders'
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_%I_updated_at ON public.%I',
      target_table,
      target_table
    );
    EXECUTE format(
      'CREATE TRIGGER set_%s_updated_at
         BEFORE UPDATE ON public.%I
         FOR EACH ROW
         EXECUTE FUNCTION public.set_updated_at()',
      target_table,
      target_table
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_order_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT (
    (OLD.status = 'draft'
      AND NEW.status IN ('draft', 'confirmed', 'cancelled'))
    OR (OLD.status = 'confirmed'
      AND NEW.status IN ('confirmed', 'fulfilled', 'cancelled'))
    OR (OLD.status = 'fulfilled' AND NEW.status = 'fulfilled')
    OR (OLD.status = 'cancelled' AND NEW.status = 'cancelled')
  ) THEN
    RAISE EXCEPTION
      'Illegal order transition % -> % for order %',
      OLD.status, NEW.status, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Snapshot-defining fields freeze the moment the order leaves draft.
  IF OLD.status <> 'draft' THEN
    IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
      OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
      OR NEW.total_cents IS DISTINCT FROM OLD.total_cents THEN
      RAISE EXCEPTION
        'Order % snapshot fields are immutable after draft', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.status IN ('confirmed', 'fulfilled') THEN
    IF NEW.confirmed_by IS NULL OR NEW.confirmed_at IS NULL THEN
      RAISE EXCEPTION
        'Order % cannot enter % without confirmation actor and time',
        NEW.id, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.status = 'fulfilled'
    AND (NEW.fulfilled_by IS NULL OR NEW.fulfilled_at IS NULL) THEN
    RAISE EXCEPTION
      'Order % cannot be fulfilled without fulfillment actor and time', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'cancelled' THEN
    IF NEW.cancelled_by IS NULL
      OR NEW.cancelled_at IS NULL
      OR btrim(NEW.cancellation_reason) = '' THEN
      RAISE EXCEPTION
        'Order % cannot be cancelled without actor, time, and reason', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status = 'fulfilled' AND OLD.status = 'cancelled' THEN
      RAISE EXCEPTION 'Cancelled orders cannot change status'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_order_lifecycle ON public.orders;

CREATE TRIGGER enforce_order_lifecycle
BEFORE UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.enforce_order_lifecycle();

CREATE OR REPLACE FUNCTION public.reject_line_item_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT o.status INTO parent_status
  FROM public.orders o
  WHERE o.id = COALESCE(NEW.order_id, OLD.order_id);

  -- A missing parent means the order row itself is being removed and this
  -- mutation is part of the ON DELETE CASCADE; allow it.
  IF parent_status IS NOT NULL AND parent_status <> 'draft' THEN
    RAISE EXCEPTION
      'Order lines are immutable while the parent order is %', parent_status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS reject_line_item_mutation ON public.order_line_items;

CREATE TRIGGER reject_line_item_mutation
BEFORE INSERT OR UPDATE OR DELETE ON public.order_line_items
FOR EACH ROW
EXECUTE FUNCTION public.reject_line_item_mutation();

CREATE OR REPLACE FUNCTION public.assert_balanced_journal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  total_debits bigint;
  total_credits bigint;
  entry_count bigint;
BEGIN
  SELECT
    COALESCE(sum(amount_cents) FILTER (WHERE side = 'debit'), 0),
    COALESCE(sum(amount_cents) FILTER (WHERE side = 'credit'), 0),
    count(*)
  INTO
    total_debits,
    total_credits,
    entry_count
  FROM public.ledger_entries
  WHERE journal_id = NEW.journal_id;

  IF total_debits <> total_credits OR entry_count <> 2 THEN
    RAISE EXCEPTION
      'Journal % is not balanced: % debits, % credits across % entries',
      NEW.journal_id, total_debits, total_credits, entry_count
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS assert_balanced_journal ON public.ledger_entries;

CREATE CONSTRAINT TRIGGER assert_balanced_journal
AFTER INSERT ON public.ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.assert_balanced_journal();

CREATE OR REPLACE FUNCTION public.reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING ERRCODE = '55006';
END;
$$;

-- The audit trail permits exactly one update: deleting an identity nulls
-- audit_log.actor_user_id through ON DELETE SET NULL.
CREATE OR REPLACE FUNCTION public.enforce_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.actor_user_id IS NULL
    AND OLD.actor_user_id IS NOT NULL
    AND NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.action IS NOT DISTINCT FROM OLD.action
    AND NEW.entity_type IS NOT DISTINCT FROM OLD.entity_type
    AND NEW.entity_id IS NOT DISTINCT FROM OLD.entity_id
    AND NEW.metadata IS NOT DISTINCT FROM OLD.metadata
    AND NEW.correlation_id IS NOT DISTINCT FROM OLD.correlation_id
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'audit_log is append-only'
    USING ERRCODE = '55006';
END;
$$;

DO $$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'stock_movements',
    'ledger_entries'
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS reject_append_only_mutation ON public.%I',
      target_table
    );
    EXECUTE format(
      'CREATE TRIGGER reject_append_only_mutation
         BEFORE UPDATE OR DELETE ON public.%I
         FOR EACH ROW
         EXECUTE FUNCTION public.reject_append_only_mutation()',
      target_table
    );
  END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS enforce_audit_append_only ON public.audit_log;

CREATE TRIGGER enforce_audit_append_only
BEFORE UPDATE OR DELETE ON public.audit_log
FOR EACH ROW
EXECUTE FUNCTION public.enforce_audit_append_only();
