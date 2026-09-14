-- Patient supplier invoices may be imported before an order exists.
-- Keep their original document, patient ownership and normal settlement rules.
ALTER TABLE external_invoices DROP CONSTRAINT external_invoice_scope_context;
ALTER TABLE external_invoices ADD CONSTRAINT external_invoice_scope_context CHECK (
    (invoice_scope = 'patient_order' AND patient_id IS NOT NULL
      AND (order_id IS NOT NULL OR source_concierge_expense_id IS NOT NULL OR source_document_id IS NOT NULL))
    OR
    (invoice_scope = 'company' AND patient_id IS NULL AND order_id IS NULL
      AND source_concierge_expense_id IS NULL AND order_leistung_id IS NULL)
);

CREATE UNIQUE INDEX external_invoices_patient_unassigned_number_unique
    ON external_invoices(patient_id, LOWER(BTRIM(supplier_name)), external_invoice_number)
    WHERE invoice_scope = 'patient_order' AND order_id IS NULL AND source_document_id IS NOT NULL
      AND source_concierge_expense_id IS NULL;

COMMENT ON COLUMN external_invoices.invoice_scope IS
    'patient_order for a patient cost with optional order; company for a supplier invoice addressed directly to GMED.';

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
    IF NEW.invoice_scope = 'company' THEN
        IF NEW.patient_id IS NOT NULL
           OR NEW.order_id IS NOT NULL
           OR NEW.order_leistung_id IS NOT NULL
           OR NEW.source_concierge_expense_id IS NOT NULL
        THEN
            RAISE EXCEPTION 'Company invoice cannot use patient or order context';
        END IF;
        IF UPPER(BTRIM(NEW.currency)) !~ '^[A-Z]{3}$' THEN
            RAISE EXCEPTION 'Company invoice currency must be a three-letter code';
        END IF;
        NEW.currency := UPPER(BTRIM(NEW.currency));
        RETURN NEW;
    END IF;

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
        IF NEW.source_concierge_expense_id IS NULL AND NEW.source_document_id IS NULL THEN
            RAISE EXCEPTION 'External invoice without order requires an invoice document or Concierge expense source';
        END IF;
        IF NEW.order_leistung_id IS NOT NULL THEN
            RAISE EXCEPTION 'External invoice service requires an order';
        END IF;
        IF UPPER(BTRIM(NEW.currency)) !~ '^[A-Z]{3}$' THEN
            RAISE EXCEPTION 'Invoice currency must be a three-letter code';
        END IF;
        NEW.currency := COALESCE(source_currency, UPPER(BTRIM(NEW.currency)));
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
