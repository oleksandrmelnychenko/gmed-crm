-- The order and invoice payer dialogs say whether a free-text payer contact
-- (`payer_contact_name`, screened as sanctions subject `payer_contact` since
-- migration 20261012061500) is an organisation, like the relation dialog's
-- box (`patient_relations.is_organisation`). See
-- docs/architecture/sanctions-screening_ua.md.
--
-- TRUE: screened against the listed entities by the whole name; FALSE: a
-- person by given names and surname. NULL (rows from before the box, payers
-- written without a contact name) keeps the guess by the legal form in the
-- name.

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS payer_contact_is_organisation BOOLEAN;
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS payer_contact_is_organisation BOOLEAN;

COMMENT ON COLUMN orders.payer_contact_is_organisation IS
    'Free-text payer contact is an organisation (sanctions screening against list entities); NULL = not answered, the legal form in the name decides';
COMMENT ON COLUMN invoices.payer_contact_is_organisation IS
    'Free-text payer contact is an organisation (sanctions screening against list entities); NULL = not answered, the legal form in the name decides';

-- The payer contact triggers of migration 20261012061500, now also on the
-- organisation box: a changed answer screens the contact again.
CREATE OR REPLACE FUNCTION sanctions_enqueue_of_order_payer_contact() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NULLIF(btrim(NEW.payer_contact_name), '') IS NULL THEN
            RETURN NEW;
        END IF;
    ELSIF NEW.payer_contact_name IS NOT DISTINCT FROM OLD.payer_contact_name
        AND NEW.payer_address_country IS NOT DISTINCT FROM OLD.payer_address_country
        AND NEW.payer_contact_is_organisation IS NOT DISTINCT FROM OLD.payer_contact_is_organisation
        AND NEW.patient_id IS NOT DISTINCT FROM OLD.patient_id
        AND NEW.source_lead_id IS NOT DISTINCT FROM OLD.source_lead_id
    THEN
        RETURN NEW;
    END IF;
    IF NEW.patient_id IS NOT NULL THEN
        PERFORM sanctions_enqueue('patient', NEW.patient_id);
    END IF;
    IF NEW.source_lead_id IS NOT NULL THEN
        PERFORM sanctions_enqueue('lead', NEW.source_lead_id);
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF OLD.patient_id IS NOT NULL AND OLD.patient_id IS DISTINCT FROM NEW.patient_id THEN
            PERFORM sanctions_enqueue('patient', OLD.patient_id);
        END IF;
        IF OLD.source_lead_id IS NOT NULL
            AND OLD.source_lead_id IS DISTINCT FROM NEW.source_lead_id
        THEN
            PERFORM sanctions_enqueue('lead', OLD.source_lead_id);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sanctions_enqueue_of_order_payer_contact ON orders;
CREATE TRIGGER trg_sanctions_enqueue_of_order_payer_contact
    AFTER INSERT OR UPDATE OF payer_contact_name, payer_address_country,
        payer_contact_is_organisation, patient_id, source_lead_id
    ON orders
    FOR EACH ROW
    EXECUTE FUNCTION sanctions_enqueue_of_order_payer_contact();

CREATE OR REPLACE FUNCTION sanctions_enqueue_of_invoice_payer_contact() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NULLIF(btrim(NEW.payer_contact_name), '') IS NULL THEN
            RETURN NEW;
        END IF;
    ELSIF NEW.payer_contact_name IS NOT DISTINCT FROM OLD.payer_contact_name
        AND NEW.payer_address_country IS NOT DISTINCT FROM OLD.payer_address_country
        AND NEW.payer_contact_is_organisation IS NOT DISTINCT FROM OLD.payer_contact_is_organisation
        AND NEW.patient_id IS NOT DISTINCT FROM OLD.patient_id
    THEN
        RETURN NEW;
    END IF;
    IF NEW.patient_id IS NOT NULL THEN
        PERFORM sanctions_enqueue('patient', NEW.patient_id);
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.patient_id IS NOT NULL
        AND OLD.patient_id IS DISTINCT FROM NEW.patient_id
    THEN
        PERFORM sanctions_enqueue('patient', OLD.patient_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sanctions_enqueue_of_invoice_payer_contact ON invoices;
CREATE TRIGGER trg_sanctions_enqueue_of_invoice_payer_contact
    AFTER INSERT OR UPDATE OF payer_contact_name, payer_address_country,
        payer_contact_is_organisation, patient_id
    ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION sanctions_enqueue_of_invoice_payer_contact();
