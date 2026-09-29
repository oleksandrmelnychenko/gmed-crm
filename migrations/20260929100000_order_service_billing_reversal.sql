-- Cancelling a service whose billing is already in force (owner decision
-- 2026-09-29, "можна добавити скасування?" -> yes).
--
-- * An approved/delivered order line that no released invoice bills is
--   cancelled with a reason, like a planned one.
-- * An order line a released invoice bills is cancelled together with a
--   credit note (Rechnungskorrektur) for that line on each such invoice, in
--   one transaction. The credit note names the cancelled line
--   (`source_order_leistung_id`) so the pair stays traceable; such a credit
--   note cannot be reversed on its own (the service stays cancelled).
-- * An approved interpreter report whose billing was reversed with its
--   appointment's cancellation keeps its approval (the hours record) and
--   records who reversed the billing, when and why; the billing sync never
--   bills it again.
-- * A billed or settled concierge service cancelled with its billing reversed
--   gets the billing state `reversed` (terminal for that billing cycle; a
--   reopened service starts a new cycle in `draft`) and records who, when,
--   why and which order line was reversed.
-- Nothing is deleted; existing rows keep their values.

ALTER TABLE invoice_credit_note_transactions
    ADD COLUMN IF NOT EXISTS source_order_leistung_id UUID
        REFERENCES order_leistungen(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_invoice_credit_note_transactions_order_service
    ON invoice_credit_note_transactions(source_order_leistung_id)
    WHERE source_order_leistung_id IS NOT NULL;

COMMENT ON COLUMN invoice_credit_note_transactions.source_order_leistung_id IS
    'Order service cancelled together with this credit note (cancellation with a credit note); NULL for credit notes issued on their own.';

ALTER TABLE interpreter_reports
    ADD COLUMN IF NOT EXISTS billing_reversed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS billing_reversed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS billing_reversal_reason TEXT;

ALTER TABLE interpreter_reports
    DROP CONSTRAINT IF EXISTS interpreter_reports_billing_reversal_consistent;
ALTER TABLE interpreter_reports
    ADD CONSTRAINT interpreter_reports_billing_reversal_consistent
    CHECK (
        (billing_reversed_at IS NULL AND billing_reversed_by IS NULL AND billing_reversal_reason IS NULL)
        OR (approval_status = 'approved'
            AND billing_reversed_at IS NOT NULL
            AND billing_reversed_by IS NOT NULL
            AND length(btrim(COALESCE(billing_reversal_reason, ''))) BETWEEN 3 AND 1000)
    );

COMMENT ON COLUMN interpreter_reports.billing_reversed_at IS
    'When the billing of this approved report was reversed (appointment cancelled with billing reversal); the billing sync skips such reports.';

ALTER TABLE concierge_services
    DROP CONSTRAINT IF EXISTS concierge_services_billing_status_check;
ALTER TABLE concierge_services
    ADD CONSTRAINT concierge_services_billing_status_check CHECK (
        billing_status IN ('draft', 'ready', 'billed', 'settled', 'waived', 'reversed')
    );

ALTER TABLE tasks
    DROP CONSTRAINT IF EXISTS tasks_billing_status_check;
ALTER TABLE tasks
    ADD CONSTRAINT tasks_billing_status_check CHECK (
        billing_status IN ('draft', 'ready', 'billed', 'settled', 'waived', 'reversed')
    );

ALTER TABLE concierge_services
    ADD COLUMN IF NOT EXISTS billing_reversed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS billing_reversed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS billing_reversal_reason TEXT,
    ADD COLUMN IF NOT EXISTS billing_reversal_order_leistung_id UUID
        REFERENCES order_leistungen(id) ON DELETE RESTRICT;

ALTER TABLE concierge_services
    DROP CONSTRAINT IF EXISTS concierge_services_billing_reversal_consistent;
ALTER TABLE concierge_services
    ADD CONSTRAINT concierge_services_billing_reversal_consistent
    CHECK (
        (billing_reversed_at IS NULL AND billing_reversed_by IS NULL
         AND billing_reversal_reason IS NULL AND billing_reversal_order_leistung_id IS NULL
         AND billing_status <> 'reversed')
        OR (billing_reversed_at IS NOT NULL
            AND billing_reversed_by IS NOT NULL
            AND length(btrim(COALESCE(billing_reversal_reason, ''))) BETWEEN 3 AND 1000)
    );

COMMENT ON COLUMN concierge_services.billing_reversal_order_leistung_id IS
    'Order line whose billing was reversed (cancelled, with a credit note when invoiced) when this billed service was cancelled; NULL when the service was billed outside GMED.';

-- Billing moves the database accepts: a billed or settled service may be
-- reversed (only through the cancellation with billing reversal, which the
-- API enforces); a reopened reversed service starts a new cycle in draft.
CREATE OR REPLACE FUNCTION concierge_billing_transition_allowed(p_from TEXT, p_to TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT p_from = p_to
        OR (p_from, p_to) IN (
            ('draft', 'ready'),
            ('draft', 'waived'),
            ('ready', 'billed'),
            ('ready', 'waived'),
            ('ready', 'draft'),
            ('billed', 'settled'),
            ('billed', 'reversed'),
            ('settled', 'reversed'),
            ('waived', 'draft'),
            ('reversed', 'draft')
        )
$$;

CREATE OR REPLACE FUNCTION concierge_billing_status_for_task(
    p_previous_task_status TEXT,
    p_task_status TEXT,
    p_billing_status TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_task_status IS NOT DISTINCT FROM p_previous_task_status THEN p_billing_status
        WHEN p_task_status = 'completed' AND p_billing_status = 'draft' THEN 'ready'
        WHEN p_task_status = 'cancelled' AND p_billing_status IN ('draft', 'ready') THEN 'waived'
        WHEN p_task_status NOT IN ('completed', 'cancelled')
             AND p_previous_task_status = 'completed'
             AND p_billing_status = 'ready' THEN 'draft'
        WHEN p_task_status NOT IN ('completed', 'cancelled')
             AND p_previous_task_status = 'cancelled'
             AND p_billing_status IN ('waived', 'reversed') THEN 'draft'
        ELSE p_billing_status
    END
$$;
