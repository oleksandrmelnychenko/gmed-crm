-- Follow-up of the patient relation screening (migration 20261011203500,
-- QA 2026-10-11 B-25). See docs/architecture/sanctions-screening_ua.md.
--
-- 1. The relation dialog says whether a separate contact is an organisation
--    (`patient_relations.is_organisation`): screened against the listed
--    entities by its whole name, a person by given names and surname. NULL —
--    rows from before the box and relations written elsewhere (patient
--    creation, lead conversion) — keeps the legal-form guess.
-- 2. A free-text payer contact of an order or an invoice
--    (`payer_contact_name`, not a relation) is screened as subject
--    `payer_contact`: one subject per name (`subject_ref` `contact-` and 16
--    hex characters of the name's hash), owned by the patient of an active or
--    inactive patient's order or invoice, by the lead for an order of a lead
--    whose patient is still prospective. Its address country
--    (`payer_address_country`) counts for the blocked-country policy like the
--    relation's country.

ALTER TABLE patient_relations
    ADD COLUMN IF NOT EXISTS is_organisation BOOLEAN;

COMMENT ON COLUMN patient_relations.is_organisation IS
    'Separate contact is an organisation (sanctions screening against list entities); NULL = not answered, the legal form in the name decides';

-- The subject kind check (last set by migration 20261011203500); a copy whose
-- check carries another name is covered by dropping every single-column
-- check on the column.
DO $$
DECLARE
    kind_check RECORD;
BEGIN
    FOR kind_check IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'c'
          AND c.conrelid = 'sanctions_hits'::regclass
          AND a.attname = 'subject_kind'
          AND array_length(c.conkey, 1) = 1
    LOOP
        EXECUTE format('ALTER TABLE sanctions_hits DROP CONSTRAINT IF EXISTS %I', kind_check.conname);
    END LOOP;
END $$;

ALTER TABLE sanctions_hits
    ADD CONSTRAINT sanctions_hits_subject_kind_check CHECK (
        subject_kind IN (
            'lead_patient', 'lead_guardian', 'lead_payer', 'lead_bank', 'lead_recipient',
            'patient', 'patient_relation', 'payer_contact'
        )
    );

-- A payer contact belongs to the patient or, while the lead's patient is
-- prospective, to the lead — exactly one of them.
ALTER TABLE sanctions_hits
    DROP CONSTRAINT IF EXISTS sanctions_hits_owner_check;
ALTER TABLE sanctions_hits
    ADD CONSTRAINT sanctions_hits_owner_check CHECK (
        (subject_kind IN ('patient', 'patient_relation')
            AND patient_id IS NOT NULL AND lead_id IS NULL)
        OR (subject_kind = 'payer_contact' AND num_nonnulls(lead_id, patient_id) = 1)
        OR (subject_kind NOT IN ('patient', 'patient_relation', 'payer_contact')
            AND lead_id IS NOT NULL AND patient_id IS NULL)
    );

ALTER TABLE sanctions_hits
    DROP CONSTRAINT IF EXISTS sanctions_hits_payer_contact_ref_check;
ALTER TABLE sanctions_hits
    ADD CONSTRAINT sanctions_hits_payer_contact_ref_check CHECK (
        subject_kind <> 'payer_contact' OR subject_ref ~ '^contact-[0-9a-f]{16}$'
    );

-- The relation trigger of migration 20261011203500, now also on the
-- organisation box.
CREATE OR REPLACE FUNCTION sanctions_enqueue_patient_of_relation() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM sanctions_enqueue('patient', OLD.patient_id);
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT'
        OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
        OR NEW.related_name IS DISTINCT FROM OLD.related_name
        OR NEW.related_patient_id IS DISTINCT FROM OLD.related_patient_id
        OR NEW.relation_type IS DISTINCT FROM OLD.relation_type
        OR NEW.address_country IS DISTINCT FROM OLD.address_country
        OR NEW.is_default_payer IS DISTINCT FROM OLD.is_default_payer
        OR NEW.notes IS DISTINCT FROM OLD.notes
        OR NEW.is_organisation IS DISTINCT FROM OLD.is_organisation
    THEN
        PERFORM sanctions_enqueue('patient', NEW.patient_id);
        IF TG_OP = 'UPDATE' AND NEW.patient_id IS DISTINCT FROM OLD.patient_id THEN
            PERFORM sanctions_enqueue('patient', OLD.patient_id);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A payer contact named, renamed, given another country or moved on an
-- order queues the order's patient and its lead (any writer: the order payer
-- dialog, the lead's payer declaration, a family order's invoice).
CREATE OR REPLACE FUNCTION sanctions_enqueue_of_order_payer_contact() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NULLIF(btrim(NEW.payer_contact_name), '') IS NULL THEN
            RETURN NEW;
        END IF;
    ELSIF NEW.payer_contact_name IS NOT DISTINCT FROM OLD.payer_contact_name
        AND NEW.payer_address_country IS NOT DISTINCT FROM OLD.payer_address_country
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
    AFTER INSERT OR UPDATE OF payer_contact_name, payer_address_country, patient_id, source_lead_id
    ON orders
    FOR EACH ROW
    EXECUTE FUNCTION sanctions_enqueue_of_order_payer_contact();

-- The same for an invoice (owned by its patient).
CREATE OR REPLACE FUNCTION sanctions_enqueue_of_invoice_payer_contact() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NULLIF(btrim(NEW.payer_contact_name), '') IS NULL THEN
            RETURN NEW;
        END IF;
    ELSIF NEW.payer_contact_name IS NOT DISTINCT FROM OLD.payer_contact_name
        AND NEW.payer_address_country IS NOT DISTINCT FROM OLD.payer_address_country
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
    AFTER INSERT OR UPDATE OF payer_contact_name, payer_address_country, patient_id
    ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION sanctions_enqueue_of_invoice_payer_contact();
