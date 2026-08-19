-- Provider invoices need a real settlement journal. A status flag cannot
-- represent partial payments, the company account used, retries, or reversals.

ALTER TABLE external_invoices
    ADD COLUMN provider_settlement_base_status TEXT;

ALTER TABLE external_invoices
    ADD CONSTRAINT external_invoice_provider_settlement_base_status_check
    CHECK (
        provider_settlement_base_status IS NULL
        OR provider_settlement_base_status IN ('received', 'approved', 'overdue')
    );

CREATE TABLE external_invoice_provider_payment_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_invoice_id UUID NOT NULL
        REFERENCES external_invoices(id) ON DELETE RESTRICT,
    financial_account_id UUID NOT NULL
        REFERENCES company_financial_accounts(id) ON DELETE RESTRICT,
    transaction_type TEXT NOT NULL
        CHECK (transaction_type IN ('payment', 'reversal')),
    request_id UUID NOT NULL,
    reverses_transaction_id UUID
        REFERENCES external_invoice_provider_payment_transactions(id) ON DELETE RESTRICT,
    amount_gross NUMERIC(12, 2) NOT NULL CHECK (amount_gross > 0),
    currency TEXT NOT NULL CHECK (
        currency = upper(currency)
        AND currency ~ '^[A-Z]{3}$'
    ),
    paid_on DATE NOT NULL,
    payment_method TEXT NOT NULL
        CHECK (payment_method IN ('bank_transfer', 'cash', 'card', 'other')),
    reference TEXT,
    note TEXT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT external_provider_payment_shape CHECK (
        (transaction_type = 'payment' AND reverses_transaction_id IS NULL)
        OR
        (transaction_type = 'reversal' AND reverses_transaction_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX uq_external_provider_payment_request
    ON external_invoice_provider_payment_transactions(external_invoice_id, request_id);

CREATE UNIQUE INDEX uq_external_provider_payment_reversal
    ON external_invoice_provider_payment_transactions(reverses_transaction_id)
    WHERE transaction_type = 'reversal';

CREATE INDEX idx_external_provider_payment_statement
    ON external_invoice_provider_payment_transactions(
        external_invoice_id, paid_on DESC, created_at DESC
    );

CREATE INDEX idx_external_provider_payment_account
    ON external_invoice_provider_payment_transactions(
        financial_account_id, paid_on DESC, created_at DESC
    );

-- Preserve already recorded agency-paid invoices as one legacy settlement.
WITH legacy_paid AS (
    SELECT external.id AS external_invoice_id,
           COALESCE(
               (
                   SELECT entry.financial_account_id
                   FROM accounting_entries entry
                   WHERE entry.source_external_invoice_id = external.id
                     AND entry.entry_kind = 'external_invoice_payment'
                     AND entry.financial_account_id IS NOT NULL
                   ORDER BY entry.entry_date DESC, entry.created_at DESC
                   LIMIT 1
               ),
               (
                   SELECT account.id
                   FROM company_financial_accounts account
                   WHERE account.currency = UPPER(external.currency)
                     AND account.is_default
                   ORDER BY account.created_at
                   LIMIT 1
               )
           ) AS financial_account_id,
           GREATEST(
               LEAST(
                   COALESCE((
                       SELECT SUM(entry.amount_gross)
                       FROM accounting_entries entry
                       WHERE entry.source_external_invoice_id = external.id
                         AND entry.entry_kind = 'external_invoice_payment'
                   ), external.amount_gross),
                   external.amount_gross
               ),
               0
           )::NUMERIC(12, 2) AS amount_gross,
           UPPER(external.currency) AS currency,
           LEAST(
               COALESCE(external.paid_at::date, external.invoice_date, CURRENT_DATE),
               CURRENT_DATE
           ) AS paid_on,
           external.created_by
    FROM external_invoices external
    WHERE external.status = 'paid'
      AND external.paid_by = 'agency'
)
INSERT INTO external_invoice_provider_payment_transactions (
    external_invoice_id, financial_account_id, transaction_type, request_id,
    amount_gross, currency, paid_on, payment_method, reference, created_by
)
SELECT legacy.external_invoice_id,
       legacy.financial_account_id,
       'payment',
       legacy.external_invoice_id,
       legacy.amount_gross,
       legacy.currency,
       legacy.paid_on,
       'other',
       'Legacy agency payment',
       legacy.created_by
FROM legacy_paid legacy
WHERE legacy.financial_account_id IS NOT NULL
  AND legacy.amount_gross > 0
ON CONFLICT (external_invoice_id, request_id) DO NOTHING;

UPDATE external_invoices external
SET provider_settlement_base_status = CASE
        WHEN external.due_date IS NOT NULL AND external.due_date < CURRENT_DATE
            THEN 'overdue'
        ELSE 'approved'
    END
WHERE external.status = 'paid'
  AND external.paid_by = 'agency'
  AND external.provider_settlement_base_status IS NULL;

ALTER TABLE accounting_entries
    ADD COLUMN source_external_provider_payment_transaction_id UUID
        REFERENCES external_invoice_provider_payment_transactions(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX uq_accounting_external_provider_payment_transaction
    ON accounting_entries(source_external_provider_payment_transaction_id)
    WHERE source_external_provider_payment_transaction_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_external_provider_payment_transaction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    external_row external_invoices%ROWTYPE;
    account_row company_financial_accounts%ROWTYPE;
    original external_invoice_provider_payment_transactions%ROWTYPE;
    net_paid NUMERIC(12, 2);
BEGIN
    SELECT *
    INTO external_row
    FROM external_invoices
    WHERE id = NEW.external_invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'external invoice does not exist';
    END IF;
    IF external_row.status = 'cancelled' OR external_row.paid_by = 'patient' THEN
        RAISE EXCEPTION 'external invoice is not payable by the company';
    END IF;
    IF UPPER(external_row.currency) <> NEW.currency THEN
        RAISE EXCEPTION 'provider payment currency must match the external invoice';
    END IF;

    SELECT *
    INTO account_row
    FROM company_financial_accounts
    WHERE id = NEW.financial_account_id
    FOR SHARE;

    IF NOT FOUND OR account_row.currency <> NEW.currency THEN
        RAISE EXCEPTION 'financial account must use the provider payment currency';
    END IF;
    IF NEW.paid_on < account_row.opening_balance_on OR NEW.paid_on > CURRENT_DATE THEN
        RAISE EXCEPTION 'provider payment date is outside the financial account period';
    END IF;

    SELECT COALESCE(SUM(
        CASE WHEN transaction_type = 'payment' THEN amount_gross ELSE -amount_gross END
    ), 0)
    INTO net_paid
    FROM external_invoice_provider_payment_transactions
    WHERE external_invoice_id = NEW.external_invoice_id;

    IF NEW.transaction_type = 'payment' THEN
        IF NOT account_row.is_active THEN
            RAISE EXCEPTION 'financial account is inactive';
        END IF;
        IF external_row.status NOT IN ('approved', 'overdue', 'paid') THEN
            RAISE EXCEPTION 'external invoice is not approved for payment';
        END IF;
        IF net_paid + NEW.amount_gross > external_row.amount_gross THEN
            RAISE EXCEPTION 'provider payment exceeds the outstanding amount';
        END IF;
    ELSE
        SELECT *
        INTO original
        FROM external_invoice_provider_payment_transactions
        WHERE id = NEW.reverses_transaction_id
        FOR UPDATE;

        IF NOT FOUND
           OR original.external_invoice_id <> NEW.external_invoice_id
           OR original.financial_account_id <> NEW.financial_account_id
           OR original.transaction_type <> 'payment'
           OR original.amount_gross <> NEW.amount_gross
           OR original.currency <> NEW.currency
           OR NEW.paid_on < original.paid_on
        THEN
            RAISE EXCEPTION 'reversal must mirror the original provider payment';
        END IF;
        IF EXISTS (
            SELECT 1
            FROM external_invoice_provider_payment_transactions reversal
            WHERE reversal.reverses_transaction_id = original.id
              AND reversal.transaction_type = 'reversal'
        ) THEN
            RAISE EXCEPTION 'provider payment was already reversed';
        END IF;
        IF net_paid - NEW.amount_gross < 0 THEN
            RAISE EXCEPTION 'provider payment reversal exceeds the settled amount';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_external_provider_payment_transaction_trigger
    BEFORE INSERT ON external_invoice_provider_payment_transactions
    FOR EACH ROW
    EXECUTE FUNCTION validate_external_provider_payment_transaction();

CREATE OR REPLACE FUNCTION protect_external_provider_payment_transaction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'provider payment transactions are append-only; create a reversal instead';
END;
$$;

CREATE TRIGGER protect_external_provider_payment_transaction_trigger
    BEFORE UPDATE OR DELETE ON external_invoice_provider_payment_transactions
    FOR EACH ROW
    EXECUTE FUNCTION protect_external_provider_payment_transaction();

CREATE OR REPLACE FUNCTION protect_external_invoice_provider_settlement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    net_paid NUMERIC(12, 2);
BEGIN
    SELECT COALESCE(SUM(
        CASE WHEN transaction_type = 'payment' THEN amount_gross ELSE -amount_gross END
    ), 0)
    INTO net_paid
    FROM external_invoice_provider_payment_transactions
    WHERE external_invoice_id = OLD.id;

    IF net_paid <= 0 THEN
        RETURN NEW;
    END IF;
    IF NEW.order_id IS DISTINCT FROM OLD.order_id
       OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
       OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
       OR UPPER(NEW.currency) IS DISTINCT FROM UPPER(OLD.currency)
       OR NEW.amount_gross IS DISTINCT FROM OLD.amount_gross
    THEN
        RAISE EXCEPTION 'external invoice identity and amount are locked by provider payments';
    END IF;
    IF NEW.status = 'cancelled' OR NEW.paid_by = 'patient' THEN
        RAISE EXCEPTION 'reverse provider payments before cancelling or changing the payer';
    END IF;
    IF NEW.status = 'paid'
       AND NEW.paid_by = 'agency'
       AND net_paid < NEW.amount_gross
    THEN
        RAISE EXCEPTION 'record the full provider payment before marking the invoice paid';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER protect_external_invoice_provider_settlement_trigger
    BEFORE UPDATE OF order_id, patient_id, provider_id, currency, amount_gross,
                     status, paid_by
    ON external_invoices
    FOR EACH ROW
    EXECUTE FUNCTION protect_external_invoice_provider_settlement();

CREATE OR REPLACE VIEW external_invoice_provider_settlement_balances AS
WITH payments AS (
    SELECT payment_tx.external_invoice_id,
           COALESCE(SUM(
               CASE WHEN payment_tx.transaction_type = 'payment'
                    THEN payment_tx.amount_gross ELSE -payment_tx.amount_gross END
           ), 0)::NUMERIC(12, 2) AS company_paid_gross,
           MAX(payment_tx.paid_on) AS latest_payment_on,
           COUNT(*) FILTER (WHERE payment_tx.transaction_type = 'payment')::BIGINT
               AS payment_count
    FROM external_invoice_provider_payment_transactions payment_tx
    GROUP BY payment_tx.external_invoice_id
)
SELECT external.id AS external_invoice_id,
       CASE
           WHEN payments.external_invoice_id IS NULL
            AND external.status = 'paid'
            AND external.paid_by = 'agency'
               THEN external.amount_gross
           ELSE COALESCE(payments.company_paid_gross, 0)
       END::NUMERIC(12, 2)
           AS company_paid_gross,
       CASE
           WHEN external.status = 'cancelled' OR external.paid_by = 'patient' THEN 0
           ELSE GREATEST(
               external.amount_gross - CASE
                   WHEN payments.external_invoice_id IS NULL
                    AND external.status = 'paid'
                    AND external.paid_by = 'agency'
                       THEN external.amount_gross
                   ELSE COALESCE(payments.company_paid_gross, 0)
               END,
               0
           )
       END::NUMERIC(12, 2) AS remaining_provider_liability_gross,
       CASE
           WHEN external.paid_by = 'patient' THEN 'paid_by_patient'
           WHEN payments.external_invoice_id IS NULL
            AND external.status = 'paid'
            AND external.paid_by = 'agency' THEN 'paid'
           WHEN COALESCE(payments.company_paid_gross, 0) <= 0 THEN 'unpaid'
           WHEN COALESCE(payments.company_paid_gross, 0) < external.amount_gross THEN 'partial'
           ELSE 'paid'
       END AS settlement_status,
       payments.latest_payment_on,
       COALESCE(payments.payment_count, 0)::BIGINT AS payment_count
FROM external_invoices external
LEFT JOIN payments ON payments.external_invoice_id = external.id;

COMMENT ON TABLE external_invoice_provider_payment_transactions IS
    'Append-only company-to-provider settlement journal with explicit reversals.';
COMMENT ON COLUMN accounting_entries.source_external_provider_payment_transaction_id IS
    'Provider payment or reversal that created this cash movement.';
COMMENT ON VIEW external_invoice_provider_settlement_balances IS
    'Current company-paid and remaining provider liability per external invoice.';
