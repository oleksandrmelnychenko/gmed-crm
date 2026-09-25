-- A new quote for an order closes the order's older open quotes. Once staff
-- price the order again (e.g. an approved interpreter report replaced planned
-- hours, or a completed appointment added a service), nothing more may be
-- invoiced from an earlier quote, so the same service cannot be billed twice.
--
-- The earlier quote row and its version history stay. It moves to the
-- terminal status 'superseded' and records which quote replaced it and when.
-- Invoices already issued from it remain valid; advance invoices stay
-- creditable because prepayment application is scoped to the order.
-- Quotes that are already rejected/expired or carry an active final invoice
-- are left as they are.

ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_status_check;
ALTER TABLE quotes
    ADD CONSTRAINT quotes_status_check
    CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired', 'superseded'));

ALTER TABLE quote_versions DROP CONSTRAINT IF EXISTS quote_versions_status_check;
ALTER TABLE quote_versions
    ADD CONSTRAINT quote_versions_status_check
    CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired', 'superseded'));

-- NO ACTION (not CASCADE / SET NULL): the quote that replaced others is part
-- of their history and cannot be deleted while they reference it.
ALTER TABLE quotes
    ADD COLUMN IF NOT EXISTS superseded_by_quote_id UUID REFERENCES quotes(id),
    ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;

ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_superseded_consistent;
ALTER TABLE quotes
    ADD CONSTRAINT quotes_superseded_consistent
    CHECK (
        (status = 'superseded'
            AND superseded_by_quote_id IS NOT NULL
            AND superseded_by_quote_id <> id
            AND superseded_at IS NOT NULL)
        OR (status <> 'superseded'
            AND superseded_by_quote_id IS NULL
            AND superseded_at IS NULL)
    );

CREATE INDEX IF NOT EXISTS idx_quotes_superseded_by
    ON quotes(superseded_by_quote_id)
    WHERE superseded_by_quote_id IS NOT NULL;

COMMENT ON COLUMN quotes.superseded_by_quote_id IS
    'Newer quote of the same order that closed this one; set only for status superseded.';
COMMENT ON COLUMN quotes.superseded_at IS
    'When a newer quote of the same order closed this one; set only for status superseded.';

-- 'superseded' is terminal: the status and its reference cannot be changed or
-- reverted afterwards.
CREATE OR REPLACE FUNCTION protect_superseded_quote() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'superseded' AND (
        NEW.status IS DISTINCT FROM OLD.status
        OR NEW.superseded_by_quote_id IS DISTINCT FROM OLD.superseded_by_quote_id
        OR NEW.superseded_at IS DISTINCT FROM OLD.superseded_at
    ) THEN
        RAISE EXCEPTION 'A superseded quote is closed and cannot change status'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_superseded_quote_trigger ON quotes;
CREATE TRIGGER protect_superseded_quote_trigger
    BEFORE UPDATE OF status, superseded_by_quote_id, superseded_at ON quotes
    FOR EACH ROW
    EXECUTE FUNCTION protect_superseded_quote();
