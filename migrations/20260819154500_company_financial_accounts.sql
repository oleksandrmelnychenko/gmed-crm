-- Cash movement is not the same as a bank balance. Model the actual GMED
-- bank/cash/card accounts, assign accounting movements to an account, and keep
-- manual reconciliation corrections in a separate append-only journal.

CREATE TABLE company_financial_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    account_type TEXT NOT NULL
        CHECK (account_type IN ('bank', 'cash', 'card', 'other')),
    currency TEXT NOT NULL CHECK (
        currency = upper(currency)
        AND currency ~ '^[A-Z]{3}$'
    ),
    iban TEXT,
    opening_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
    opening_balance_on DATE NOT NULL DEFAULT CURRENT_DATE,
    is_default BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT company_financial_account_default_active
        CHECK (NOT is_default OR is_active)
);

CREATE UNIQUE INDEX uq_company_financial_account_name_currency
    ON company_financial_accounts(lower(trim(name)), currency);

CREATE UNIQUE INDEX uq_company_financial_account_default_currency
    ON company_financial_accounts(currency)
    WHERE is_default;

WITH currencies AS (
    SELECT DISTINCT UPPER(currency) AS currency
    FROM accounting_entries
    WHERE UPPER(currency) ~ '^[A-Z]{3}$'
    UNION
    SELECT 'EUR'
), seed_actor AS (
    SELECT id
    FROM users
    ORDER BY CASE WHEN role = 'ceo' THEN 0 ELSE 1 END, created_at, id
    LIMIT 1
)
INSERT INTO company_financial_accounts (
    name, account_type, currency, opening_balance, opening_balance_on,
    is_default, created_by
)
SELECT 'GMED ' || currencies.currency || ' Hauptkonto',
       'bank', currencies.currency, 0,
       COALESCE((SELECT MIN(entry_date) FROM accounting_entries
                 WHERE UPPER(accounting_entries.currency) = currencies.currency), CURRENT_DATE),
       true, seed_actor.id
FROM currencies
CROSS JOIN seed_actor
ON CONFLICT DO NOTHING;

ALTER TABLE accounting_entries
    ADD COLUMN financial_account_id UUID
        REFERENCES company_financial_accounts(id) ON DELETE RESTRICT;

UPDATE accounting_entries entry
SET financial_account_id = account.id
FROM company_financial_accounts account
WHERE entry.financial_account_id IS NULL
  AND account.currency = UPPER(entry.currency)
  AND account.is_default;

CREATE INDEX idx_accounting_entries_financial_account_date
    ON accounting_entries(financial_account_id, entry_date DESC, created_at DESC)
    WHERE financial_account_id IS NOT NULL;

CREATE OR REPLACE FUNCTION maintain_company_financial_account_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.opening_balance_on > CURRENT_DATE THEN
        RAISE EXCEPTION 'Opening balance date cannot be in the future';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER maintain_company_financial_account_updated_at_trigger
    BEFORE INSERT OR UPDATE ON company_financial_accounts
    FOR EACH ROW
    EXECUTE FUNCTION maintain_company_financial_account_updated_at();

CREATE OR REPLACE FUNCTION assign_and_validate_accounting_entry_account()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    account_currency TEXT;
    account_active BOOLEAN;
BEGIN
    NEW.currency := upper(NEW.currency);
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
    IF TG_OP = 'INSERT' THEN
        IF NOT account_active THEN
            RAISE EXCEPTION 'Financial account is inactive';
        END IF;
    ELSIF OLD.financial_account_id IS DISTINCT FROM NEW.financial_account_id
          AND NOT account_active THEN
        RAISE EXCEPTION 'Financial account is inactive';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER assign_and_validate_accounting_entry_account_trigger
    BEFORE INSERT OR UPDATE OF financial_account_id, currency ON accounting_entries
    FOR EACH ROW
    EXECUTE FUNCTION assign_and_validate_accounting_entry_account();

CREATE TABLE company_financial_account_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    financial_account_id UUID NOT NULL
        REFERENCES company_financial_accounts(id) ON DELETE RESTRICT,
    transaction_type TEXT NOT NULL
        CHECK (transaction_type IN ('adjustment', 'reversal')),
    request_id UUID NOT NULL,
    reverses_adjustment_id UUID
        REFERENCES company_financial_account_adjustments(id) ON DELETE RESTRICT,
    direction TEXT NOT NULL CHECK (direction IN ('inflow', 'outflow')),
    amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    effective_on DATE NOT NULL,
    reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
    note TEXT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT company_financial_account_adjustment_shape CHECK (
        (transaction_type = 'adjustment' AND reverses_adjustment_id IS NULL)
        OR
        (transaction_type = 'reversal' AND reverses_adjustment_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX uq_company_financial_account_adjustment_request
    ON company_financial_account_adjustments(financial_account_id, request_id);

CREATE UNIQUE INDEX uq_company_financial_account_adjustment_reversal
    ON company_financial_account_adjustments(reverses_adjustment_id)
    WHERE transaction_type = 'reversal';

CREATE INDEX idx_company_financial_account_adjustments_statement
    ON company_financial_account_adjustments(
        financial_account_id, effective_on DESC, created_at DESC
    );

CREATE OR REPLACE FUNCTION validate_company_financial_account_adjustment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    account_row company_financial_accounts%ROWTYPE;
    original company_financial_account_adjustments%ROWTYPE;
BEGIN
    SELECT *
    INTO account_row
    FROM company_financial_accounts
    WHERE id = NEW.financial_account_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Financial account does not exist';
    END IF;
    IF NEW.effective_on < account_row.opening_balance_on THEN
        RAISE EXCEPTION 'Adjustment cannot precede the account opening balance date';
    END IF;
    IF NEW.effective_on > CURRENT_DATE THEN
        RAISE EXCEPTION 'Adjustment date cannot be in the future';
    END IF;
    IF NEW.transaction_type = 'adjustment' AND NOT account_row.is_active THEN
        RAISE EXCEPTION 'Financial account is inactive';
    END IF;

    IF NEW.transaction_type = 'reversal' THEN
        SELECT *
        INTO original
        FROM company_financial_account_adjustments
        WHERE id = NEW.reverses_adjustment_id
        FOR UPDATE;

        IF NOT FOUND
           OR original.financial_account_id <> NEW.financial_account_id
           OR original.transaction_type <> 'adjustment'
        THEN
            RAISE EXCEPTION 'Reversal must reference an adjustment on the same account';
        END IF;
        IF NEW.direction = original.direction
           OR NEW.amount <> original.amount
           OR NEW.effective_on < original.effective_on
        THEN
            RAISE EXCEPTION 'Reversal must mirror the original adjustment';
        END IF;
        IF EXISTS (
            SELECT 1
            FROM company_financial_account_adjustments reversal
            WHERE reversal.reverses_adjustment_id = original.id
              AND reversal.transaction_type = 'reversal'
        ) THEN
            RAISE EXCEPTION 'Adjustment was already reversed';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_company_financial_account_adjustment_trigger
    BEFORE INSERT ON company_financial_account_adjustments
    FOR EACH ROW
    EXECUTE FUNCTION validate_company_financial_account_adjustment();

CREATE OR REPLACE FUNCTION protect_company_financial_account_adjustment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Financial account adjustments are append-only; create a reversal instead';
END;
$$;

CREATE TRIGGER protect_company_financial_account_adjustment_trigger
    BEFORE UPDATE OR DELETE ON company_financial_account_adjustments
    FOR EACH ROW
    EXECUTE FUNCTION protect_company_financial_account_adjustment();

COMMENT ON TABLE company_financial_accounts IS
    'Actual GMED bank, cash, card, and other cash accounts by currency.';
COMMENT ON COLUMN accounting_entries.financial_account_id IS
    'Actual company account that received or paid this cash movement.';
COMMENT ON TABLE company_financial_account_adjustments IS
    'Append-only non-EÜR cash account reconciliation journal.';
