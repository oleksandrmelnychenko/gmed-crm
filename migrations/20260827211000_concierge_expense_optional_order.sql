-- Finance may post a Concierge expense at patient/provider level without
-- assigning it to an order. The source submission remains the immutable
-- provenance for every such external invoice.

ALTER TABLE external_invoices
    ADD COLUMN source_concierge_expense_id UUID
        REFERENCES concierge_expense_submissions(id) ON DELETE RESTRICT;

UPDATE external_invoices external
SET source_concierge_expense_id = review.expense_id
FROM concierge_expense_review_events review
WHERE review.external_invoice_id = external.id
  AND review.action = 'posted';

CREATE UNIQUE INDEX uq_external_invoice_concierge_expense
    ON external_invoices(source_concierge_expense_id)
    WHERE source_concierge_expense_id IS NOT NULL;

ALTER TABLE external_invoices
    ALTER COLUMN order_id DROP NOT NULL,
    ADD CONSTRAINT external_invoice_order_or_concierge_source
        CHECK (order_id IS NOT NULL OR source_concierge_expense_id IS NOT NULL),
    ADD CONSTRAINT external_invoice_line_requires_order
        CHECK (order_leistung_id IS NULL OR order_id IS NOT NULL);

CREATE OR REPLACE FUNCTION validate_external_invoice_service_economics()
RETURNS trigger AS $$
DECLARE
    service_order_id UUID;
    service_currency TEXT;
    service_provider_id UUID;
    order_currency TEXT;
    source_patient_id UUID;
    source_currency TEXT;
    source_order_id UUID;
    source_order_leistung_id UUID;
BEGIN
    IF NEW.source_concierge_expense_id IS NOT NULL THEN
        SELECT patient_id, currency, order_id, order_leistung_id
        INTO source_patient_id, source_currency, source_order_id, source_order_leistung_id
        FROM concierge_expense_submissions
        WHERE id = NEW.source_concierge_expense_id
        FOR SHARE;

        IF source_patient_id IS NULL
           OR NEW.patient_id <> source_patient_id
           OR UPPER(NEW.currency) <> source_currency
        THEN
            RAISE EXCEPTION 'External invoice must match its Concierge expense source';
        END IF;
        IF source_order_id IS NOT NULL
           AND NEW.order_id IS DISTINCT FROM source_order_id
        THEN
            RAISE EXCEPTION 'External invoice must preserve the submitted Concierge order';
        END IF;
        IF source_order_leistung_id IS NOT NULL
           AND NEW.order_leistung_id IS DISTINCT FROM source_order_leistung_id
        THEN
            RAISE EXCEPTION 'External invoice must preserve the submitted Concierge order service';
        END IF;
    END IF;

    IF NEW.order_id IS NULL THEN
        IF NEW.source_concierge_expense_id IS NULL THEN
            RAISE EXCEPTION 'External invoice without order requires a Concierge expense source';
        END IF;
        IF NEW.order_leistung_id IS NOT NULL THEN
            RAISE EXCEPTION 'External invoice service requires an order';
        END IF;
        NEW.currency := source_currency;
        RETURN NEW;
    END IF;

    SELECT UPPER(currency)
    INTO order_currency
    FROM orders
    WHERE id = NEW.order_id
    FOR SHARE;

    IF order_currency IS NULL OR UPPER(NEW.currency) <> order_currency THEN
        RAISE EXCEPTION 'External invoice currency must match order currency';
    END IF;

    IF NEW.order_leistung_id IS NOT NULL THEN
        SELECT order_id, UPPER(currency), provider_id
        INTO service_order_id, service_currency, service_provider_id
        FROM order_leistungen
        WHERE id = NEW.order_leistung_id
        FOR UPDATE;

        IF service_order_id IS NULL THEN
            RAISE EXCEPTION 'Order service not found';
        END IF;
        IF service_order_id <> NEW.order_id THEN
            RAISE EXCEPTION 'External invoice service must belong to the same order';
        END IF;
        IF service_currency <> order_currency THEN
            RAISE EXCEPTION 'Order service currency must match order currency';
        END IF;
        IF NEW.provider_id IS NOT NULL
           AND service_provider_id IS NOT NULL
           AND NEW.provider_id <> service_provider_id THEN
            RAISE EXCEPTION 'External invoice provider must match order service provider';
        END IF;
    END IF;

    NEW.currency := order_currency;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_concierge_expense_invoice_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.action IN ('posted', 'reversed')
       AND NOT EXISTS (
           SELECT 1
           FROM external_invoices external
           WHERE external.id = NEW.external_invoice_id
             AND external.source_concierge_expense_id = NEW.expense_id
       )
    THEN
        RAISE EXCEPTION 'Concierge expense review must reference its canonical external invoice';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_concierge_expense_invoice_provenance_trigger
    BEFORE INSERT ON concierge_expense_review_events
    FOR EACH ROW
    EXECUTE FUNCTION validate_concierge_expense_invoice_provenance();

CREATE OR REPLACE FUNCTION protect_external_invoice_concierge_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.source_concierge_expense_id IS DISTINCT FROM OLD.source_concierge_expense_id THEN
        RAISE EXCEPTION 'External invoice Concierge source is immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER protect_external_invoice_concierge_source_trigger
    BEFORE UPDATE OF source_concierge_expense_id ON external_invoices
    FOR EACH ROW
    EXECUTE FUNCTION protect_external_invoice_concierge_source();

COMMENT ON COLUMN external_invoices.source_concierge_expense_id IS
    'Immutable Concierge expense provenance; permits patient/provider-level posting without an order.';
