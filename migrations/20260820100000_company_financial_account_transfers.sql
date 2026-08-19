-- Internal movements between GMED bank/cash/card accounts must affect each
-- account balance without changing the company's combined cash position.

CREATE TABLE company_financial_account_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_type TEXT NOT NULL
        CHECK (transaction_type IN ('transfer', 'reversal')),
    request_id UUID NOT NULL UNIQUE,
    reverses_transfer_id UUID
        REFERENCES company_financial_account_transfers(id) ON DELETE RESTRICT,
    source_account_id UUID NOT NULL
        REFERENCES company_financial_accounts(id) ON DELETE RESTRICT,
    target_account_id UUID NOT NULL
        REFERENCES company_financial_accounts(id) ON DELETE RESTRICT,
    amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    currency TEXT NOT NULL CHECK (
        currency = upper(currency)
        AND currency ~ '^[A-Z]{3}$'
    ),
    effective_on DATE NOT NULL,
    reference TEXT CHECK (
        reference IS NULL OR length(trim(reference)) BETWEEN 1 AND 120
    ),
    note TEXT CHECK (note IS NULL OR length(note) <= 2000),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT company_financial_account_transfer_distinct_accounts
        CHECK (source_account_id <> target_account_id),
    CONSTRAINT company_financial_account_transfer_shape CHECK (
        (transaction_type = 'transfer' AND reverses_transfer_id IS NULL)
        OR
        (transaction_type = 'reversal' AND reverses_transfer_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX uq_company_financial_account_transfer_reversal
    ON company_financial_account_transfers(reverses_transfer_id)
    WHERE transaction_type = 'reversal';

CREATE INDEX idx_company_financial_account_transfer_source_statement
    ON company_financial_account_transfers(
        source_account_id, effective_on DESC, created_at DESC
    );

CREATE INDEX idx_company_financial_account_transfer_target_statement
    ON company_financial_account_transfers(
        target_account_id, effective_on DESC, created_at DESC
    );

CREATE OR REPLACE FUNCTION validate_company_financial_account_transfer()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    account_count INTEGER;
    source_currency TEXT;
    source_active BOOLEAN;
    source_opening_on DATE;
    target_currency TEXT;
    target_active BOOLEAN;
    target_opening_on DATE;
    original company_financial_account_transfers%ROWTYPE;
BEGIN
    PERFORM 1
    FROM company_financial_accounts
    WHERE id IN (NEW.source_account_id, NEW.target_account_id)
    ORDER BY id
    FOR UPDATE;

    SELECT COUNT(*)
    INTO account_count
    FROM company_financial_accounts
    WHERE id IN (NEW.source_account_id, NEW.target_account_id);

    IF account_count <> 2 THEN
        RAISE EXCEPTION 'Both financial accounts must exist';
    END IF;

    SELECT currency, is_active, opening_balance_on
    INTO source_currency, source_active, source_opening_on
    FROM company_financial_accounts
    WHERE id = NEW.source_account_id;

    SELECT currency, is_active, opening_balance_on
    INTO target_currency, target_active, target_opening_on
    FROM company_financial_accounts
    WHERE id = NEW.target_account_id;

    IF source_currency <> target_currency OR NEW.currency <> source_currency THEN
        RAISE EXCEPTION 'Internal transfer accounts must use the same currency';
    END IF;
    IF NEW.effective_on < source_opening_on OR NEW.effective_on < target_opening_on THEN
        RAISE EXCEPTION 'Transfer cannot precede an account opening date';
    END IF;
    IF NEW.effective_on > CURRENT_DATE THEN
        RAISE EXCEPTION 'Transfer date cannot be in the future';
    END IF;

    IF NEW.transaction_type = 'transfer' THEN
        IF NOT source_active OR NOT target_active THEN
            RAISE EXCEPTION 'Internal transfer accounts must be active';
        END IF;
    ELSE
        IF NEW.reference IS NULL OR trim(NEW.reference) = '' THEN
            RAISE EXCEPTION 'Internal transfer reversal reason is required';
        END IF;
        SELECT *
        INTO original
        FROM company_financial_account_transfers
        WHERE id = NEW.reverses_transfer_id
        FOR UPDATE;

        IF NOT FOUND
           OR original.transaction_type <> 'transfer'
           OR original.source_account_id <> NEW.target_account_id
           OR original.target_account_id <> NEW.source_account_id
           OR original.amount <> NEW.amount
           OR original.currency <> NEW.currency
           OR NEW.effective_on < original.effective_on
        THEN
            RAISE EXCEPTION 'Reversal must mirror the original internal transfer';
        END IF;
        IF EXISTS (
            SELECT 1
            FROM company_financial_account_transfers reversal
            WHERE reversal.reverses_transfer_id = original.id
              AND reversal.transaction_type = 'reversal'
        ) THEN
            RAISE EXCEPTION 'Internal transfer was already reversed';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_company_financial_account_transfer_trigger
    BEFORE INSERT ON company_financial_account_transfers
    FOR EACH ROW
    EXECUTE FUNCTION validate_company_financial_account_transfer();

CREATE OR REPLACE FUNCTION protect_company_financial_account_transfer()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Internal account transfers are append-only; create a reversal instead';
END;
$$;

CREATE TRIGGER protect_company_financial_account_transfer_trigger
    BEFORE UPDATE OR DELETE ON company_financial_account_transfers
    FOR EACH ROW
    EXECUTE FUNCTION protect_company_financial_account_transfer();

COMMENT ON TABLE company_financial_account_transfers IS
    'Append-only same-currency internal transfers between GMED cash accounts.';
