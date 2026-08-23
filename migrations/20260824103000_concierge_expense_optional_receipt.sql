-- A Concierge expense may be submitted for financial review before a receipt
-- exists.  The missing-document choice is represented by both receipt fields
-- being NULL; a later review can therefore distinguish it from a broken file.

ALTER TABLE concierge_expense_submissions
    ALTER COLUMN receipt_document_id DROP NOT NULL,
    ALTER COLUMN receipt_sha256 DROP NOT NULL;

ALTER TABLE concierge_expense_submissions
    ADD CONSTRAINT concierge_expense_receipt_pair
    CHECK (
        (receipt_document_id IS NULL AND receipt_sha256 IS NULL)
        OR (receipt_document_id IS NOT NULL AND receipt_sha256 IS NOT NULL)
    );

CREATE OR REPLACE FUNCTION validate_concierge_expense_submission()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    service_patient UUID;
    order_patient UUID;
    order_currency TEXT;
    leistung_order UUID;
    leistung_currency TEXT;
    document_patient UUID;
    document_order UUID;
    document_visibility TEXT;
    document_is_medical BOOLEAN;
BEGIN
    SELECT patient_id
    INTO service_patient
    FROM concierge_services
    WHERE id = NEW.concierge_service_id
    FOR UPDATE;

    IF service_patient IS NULL OR NEW.patient_id <> service_patient THEN
        RAISE EXCEPTION 'concierge expense patient and service must match';
    END IF;

    IF NEW.order_id IS NOT NULL THEN
        SELECT patient_id, upper(currency)
        INTO order_patient, order_currency
        FROM orders
        WHERE id = NEW.order_id
        FOR UPDATE;
        IF order_patient IS NULL OR NEW.patient_id <> order_patient THEN
            RAISE EXCEPTION 'concierge expense order must belong to the same patient';
        END IF;
        IF order_currency <> NEW.currency THEN
            RAISE EXCEPTION 'concierge expense currency must match the order';
        END IF;
    END IF;

    IF NEW.order_leistung_id IS NOT NULL THEN
        SELECT order_id, upper(currency)
        INTO leistung_order, leistung_currency
        FROM order_leistungen
        WHERE id = NEW.order_leistung_id
        FOR UPDATE;
        IF leistung_order IS NULL
           OR leistung_order <> NEW.order_id
           OR leistung_currency <> NEW.currency
        THEN
            RAISE EXCEPTION 'concierge expense service line must match order and currency';
        END IF;
    END IF;

    IF NEW.receipt_document_id IS NOT NULL THEN
        SELECT patient_id, order_id, visibility, is_medical
        INTO document_patient, document_order, document_visibility, document_is_medical
        FROM documents
        WHERE id = NEW.receipt_document_id
        FOR UPDATE;
        IF document_patient IS NULL
           OR document_patient <> NEW.patient_id
           OR document_order IS DISTINCT FROM NEW.order_id
           OR document_visibility <> 'internal'
           OR document_is_medical
        THEN
            RAISE EXCEPTION 'receipt document must be internal, non-medical, and bound to the same patient and order';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON CONSTRAINT concierge_expense_receipt_pair ON concierge_expense_submissions IS
    'Both receipt references are present, or both are absent when the submitter selected no document.';
