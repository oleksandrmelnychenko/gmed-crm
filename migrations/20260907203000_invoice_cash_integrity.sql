-- Forward-only safeguards. Existing journals and account balances are not rewritten.
CREATE FUNCTION validate_invoice_payment_retained_cash() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    original invoice_payment_transactions%ROWTYPE;
    retained NUMERIC;
    allocated NUMERIC;
BEGIN
    IF NEW.transaction_type <> 'reversal' THEN RETURN NEW; END IF;
    -- Same source invoice lock as allocation/refund validation serializes writers.
    PERFORM 1 FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;
    SELECT * INTO STRICT original FROM invoice_payment_transactions
    WHERE id = NEW.reverses_transaction_id;
    IF NEW.received_on < original.received_on THEN
        RAISE EXCEPTION 'Payment reversal cannot precede the original receipt';
    END IF;
    SELECT COALESCE(SUM(CASE WHEN transaction_type = 'payment' THEN amount_gross ELSE -amount_gross END), 0)
    INTO retained FROM invoice_payment_transactions WHERE invoice_id = NEW.invoice_id;
    retained := retained - COALESCE((SELECT SUM(CASE WHEN transaction_type = 'refund' THEN amount_gross ELSE -amount_gross END)
        FROM invoice_refund_transactions WHERE invoice_id = NEW.invoice_id), 0);
    SELECT COALESCE(SUM(amount_gross), 0) INTO allocated
    FROM invoice_prepayment_allocations WHERE advance_invoice_id = NEW.invoice_id;
    IF retained - NEW.amount_gross < allocated THEN
        RAISE EXCEPTION 'Payment reversal would leave applied advances without cash';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_invoice_payment_retained_cash_trigger
    BEFORE INSERT ON invoice_payment_transactions
    FOR EACH ROW EXECUTE FUNCTION validate_invoice_payment_retained_cash();

CREATE FUNCTION validate_invoice_prepayment_release_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM invoices WHERE id IN (NEW.advance_invoice_id, NEW.target_invoice_id)
               AND status IN ('draft', 'cancelled')) THEN
        RAISE EXCEPTION 'Prepayment allocation requires released invoices';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER validate_invoice_prepayment_release_state_trigger
    BEFORE INSERT ON invoice_prepayment_allocations
    FOR EACH ROW EXECUTE FUNCTION validate_invoice_prepayment_release_state();

CREATE OR REPLACE FUNCTION assign_and_validate_accounting_entry_account()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    account_currency TEXT;
    account_active BOOLEAN;
    provider_tx external_invoice_provider_payment_transactions%ROWTYPE;
    original_payment UUID;
    original_refund UUID;
    legacy_payment BOOLEAN := false;
    original_entry RECORD;
BEGIN
    NEW.currency := upper(NEW.currency);
    IF NEW.source_invoice_payment_transaction_id IS NOT NULL THEN
        SELECT reversal.reverses_transaction_id, original.payment_method = 'legacy_import'
        INTO original_payment, legacy_payment
        FROM invoice_payment_transactions reversal
        LEFT JOIN invoice_payment_transactions original ON original.id = reversal.reverses_transaction_id
        WHERE reversal.id = NEW.source_invoice_payment_transaction_id;
    END IF;
    IF NEW.source_invoice_refund_transaction_id IS NOT NULL THEN
        SELECT reverses_transaction_id INTO original_refund
        FROM invoice_refund_transactions WHERE id = NEW.source_invoice_refund_transaction_id;
    END IF;
    IF original_payment IS NOT NULL OR original_refund IS NOT NULL THEN
        SELECT entry.financial_account_id, entry.currency,
               SUM(entry.amount_net) AS net, SUM(entry.amount_vat) AS vat,
               SUM(entry.amount_gross) AS gross
        INTO STRICT original_entry
        FROM accounting_entries entry
        WHERE entry.source_invoice_id = NEW.source_invoice_id
          AND entry.category = NEW.category AND entry.direction = 'income'
          AND (entry.source_invoice_payment_transaction_id = original_payment
               OR entry.source_invoice_refund_transaction_id = original_refund
               OR (legacy_payment AND entry.entry_kind = 'invoice_payment'
                   AND entry.source_invoice_payment_transaction_id IS NULL
                   AND NOT EXISTS (SELECT 1 FROM accounting_entries linked
                       WHERE linked.source_invoice_payment_transaction_id = original_payment)))
        GROUP BY entry.financial_account_id, entry.currency;
        IF NEW.direction <> 'income'
           OR NEW.financial_account_id IS DISTINCT FROM original_entry.financial_account_id
           OR NEW.currency <> original_entry.currency
           OR NEW.amount_net <> -original_entry.net
           OR NEW.amount_vat <> -original_entry.vat
           OR NEW.amount_gross <> -original_entry.gross THEN
            RAISE EXCEPTION 'Invoice cash reversal must exactly mirror the original accounting entry';
        END IF;
        -- Historical reversals retain even an inactive or unassigned account.
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND (
        OLD.financial_account_id IS DISTINCT FROM NEW.financial_account_id
        OR OLD.currency IS DISTINCT FROM NEW.currency
    ) AND (EXISTS (SELECT 1 FROM invoice_payment_transactions
                  WHERE reverses_transaction_id = NEW.source_invoice_payment_transaction_id)
           OR EXISTS (SELECT 1 FROM invoice_refund_transactions
                      WHERE reverses_transaction_id = NEW.source_invoice_refund_transaction_id)) THEN
        RAISE EXCEPTION 'Reversed invoice cash accounting cannot be reassigned';
    END IF;
    IF NEW.source_external_provider_payment_transaction_id IS NOT NULL THEN
        SELECT * INTO STRICT provider_tx FROM external_invoice_provider_payment_transactions
        WHERE id = NEW.source_external_provider_payment_transaction_id;
        IF NEW.financial_account_id IS DISTINCT FROM provider_tx.financial_account_id
           OR NEW.currency <> provider_tx.currency THEN
            RAISE EXCEPTION 'Provider accounting must retain its payment journal account and currency';
        END IF;
    END IF;
    IF NEW.financial_account_id IS NULL THEN
        SELECT account.id
        INTO NEW.financial_account_id
        FROM company_financial_accounts account
        WHERE account.currency = NEW.currency
          AND account.is_default
          AND account.is_active
        LIMIT 1;
        RETURN NEW;
    END IF;

    SELECT currency, is_active
    INTO account_currency, account_active
    FROM company_financial_accounts
    WHERE id = NEW.financial_account_id
    FOR SHARE;

    IF NOT FOUND OR account_currency <> NEW.currency THEN
        RAISE EXCEPTION 'Financial account must use the accounting entry currency';
    END IF;
    IF TG_OP = 'INSERT' AND NOT account_active THEN
        IF NEW.entry_kind <> 'external_invoice_payment'
           OR NEW.direction <> 'expense'
           OR NEW.category <> 'provider_expense'
           OR NEW.source_external_provider_payment_transaction_id IS NULL
        THEN
            RAISE EXCEPTION 'Financial account is inactive';
        END IF;
        SELECT * INTO provider_tx
        FROM external_invoice_provider_payment_transactions
        WHERE id = NEW.source_external_provider_payment_transaction_id
        FOR SHARE;
        IF NOT FOUND
           OR provider_tx.transaction_type <> 'reversal'
           OR provider_tx.financial_account_id <> NEW.financial_account_id
           OR provider_tx.external_invoice_id IS DISTINCT FROM NEW.source_external_invoice_id
           OR provider_tx.currency <> NEW.currency
           OR NEW.amount_gross <> -provider_tx.amount_gross
        THEN
            RAISE EXCEPTION 'Inactive account only accepts its exact provider payment reversal';
        END IF;
    ELSIF TG_OP = 'UPDATE'
          AND OLD.financial_account_id IS DISTINCT FROM NEW.financial_account_id
          AND NOT account_active THEN
        RAISE EXCEPTION 'Financial account is inactive';
    END IF;
    RETURN NEW;
END;
$$;

-- Retain released allocations so statements at past dates remain reproducible.
CREATE TABLE invoice_prepayment_allocation_releases (
    id UUID PRIMARY KEY,
    advance_invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    target_invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    amount_gross NUMERIC(12, 2) NOT NULL CHECK (amount_gross > 0),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL,
    request_id UUID,
    released_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    released_by UUID REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX invoice_prepayment_releases_target ON invoice_prepayment_allocation_releases(target_invoice_id, created_at);
CREATE INDEX invoice_prepayment_releases_source ON invoice_prepayment_allocation_releases(advance_invoice_id, created_at);
CREATE FUNCTION retain_invoice_prepayment_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Prepayment allocations are immutable; release and reapply instead';
    END IF;
    INSERT INTO invoice_prepayment_allocation_releases (
        id, advance_invoice_id, target_invoice_id, amount_gross, created_by, created_at, request_id, released_by
    ) VALUES (
        OLD.id, OLD.advance_invoice_id, OLD.target_invoice_id, OLD.amount_gross,
        OLD.created_by, OLD.created_at, OLD.request_id,
        NULLIF(current_setting('gmed.accounting_actor_id', true), '')::UUID
    );
    RETURN OLD;
END;
$$;
CREATE TRIGGER retain_invoice_prepayment_release_trigger
    BEFORE UPDATE OR DELETE ON invoice_prepayment_allocations
    FOR EACH ROW EXECUTE FUNCTION retain_invoice_prepayment_release();
CREATE FUNCTION protect_invoice_prepayment_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Prepayment release history is append-only';
END;
$$;
CREATE TRIGGER protect_invoice_prepayment_release_trigger
    BEFORE UPDATE OR DELETE ON invoice_prepayment_allocation_releases
    FOR EACH ROW EXECUTE FUNCTION protect_invoice_prepayment_release();
CREATE VIEW invoice_prepayment_allocation_history AS
SELECT id, advance_invoice_id, target_invoice_id, amount_gross, created_by, created_at,
       request_id, NULL::TIMESTAMPTZ AS released_at, NULL::UUID AS released_by
FROM invoice_prepayment_allocations
UNION ALL
SELECT id, advance_invoice_id, target_invoice_id, amount_gross, created_by, created_at,
       request_id, released_at, released_by
FROM invoice_prepayment_allocation_releases;
