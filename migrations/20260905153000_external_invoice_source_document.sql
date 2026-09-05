ALTER TABLE external_invoices
    ADD COLUMN IF NOT EXISTS source_document_id UUID REFERENCES documents(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS external_invoices_source_document_unique
    ON external_invoices(source_document_id) WHERE source_document_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_external_invoice_source_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.source_document_id IS NOT NULL THEN
        PERFORM 1 FROM documents
        WHERE id = NEW.source_document_id
          AND patient_id = NEW.patient_id AND order_id = NEW.order_id
          AND is_medical = false AND file_deleted_at IS NULL
        FOR SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Invoice source document must belong to the same patient and order'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS external_invoice_source_context ON external_invoices;
CREATE TRIGGER external_invoice_source_context
    BEFORE INSERT OR UPDATE OF source_document_id, patient_id, order_id ON external_invoices
    FOR EACH ROW EXECUTE FUNCTION validate_external_invoice_source_document();

CREATE OR REPLACE FUNCTION protect_external_invoice_document_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM external_invoices WHERE source_document_id = NEW.id
        AND (patient_id IS DISTINCT FROM NEW.patient_id OR order_id IS DISTINCT FROM NEW.order_id
             OR NEW.is_medical = true)) THEN
        RAISE EXCEPTION 'An invoice source document cannot be assigned to another patient or order'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS external_invoice_document_context ON documents;
CREATE TRIGGER external_invoice_document_context
    BEFORE UPDATE OF patient_id, order_id, is_medical ON documents
    FOR EACH ROW EXECUTE FUNCTION protect_external_invoice_document_context();
