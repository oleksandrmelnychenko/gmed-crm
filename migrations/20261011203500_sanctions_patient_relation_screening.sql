-- Sanctions screening of the patient's relations that pay or receive the
-- invoices (QA 2026-10-11 B-25: a relation marked "Оплачивает счета пациента
-- по умолчанию" became the invoice recipient without screening). The default
-- payer, a relation an order or an invoice names as payer and the parents and
-- guardians of a minor patient are screened against the EU consolidated list
-- as subject `patient_relation` (`subject_ref` = the relation id). The hit
-- belongs to the patient, like the patient's own.
-- See docs/architecture/sanctions-screening_ua.md.

-- The subject kind check (last set by migration 20261011170000 as
-- `sanctions_hits_subject_kind_check`); a copy whose check carries another
-- name is covered by dropping every single-column check on the column.
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
            'patient', 'patient_relation'
        )
    );

-- A relation's hit belongs to the patient (migration 20261004110000 allowed a
-- patient owner for `patient` only).
ALTER TABLE sanctions_hits
    DROP CONSTRAINT IF EXISTS sanctions_hits_owner_check;
ALTER TABLE sanctions_hits
    ADD CONSTRAINT sanctions_hits_owner_check CHECK (
        (subject_kind IN ('patient', 'patient_relation')
            AND patient_id IS NOT NULL AND lead_id IS NULL)
        OR (subject_kind NOT IN ('patient', 'patient_relation')
            AND lead_id IS NOT NULL AND patient_id IS NULL)
    );

-- One subject per relation: the relation id.
ALTER TABLE sanctions_hits
    DROP CONSTRAINT IF EXISTS sanctions_hits_relation_ref_check;
ALTER TABLE sanctions_hits
    ADD CONSTRAINT sanctions_hits_relation_ref_check CHECK (
        subject_kind <> 'patient_relation'
        OR subject_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    );

-- Re-screen the patient when a relation is added or removed, or when its
-- name, linked patient record, type, address country, default-payer flag or
-- notes (the lead conversion writes a contact's birth date there) change (any
-- writer: the patient card, the patient creation, the lead conversion).
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
    THEN
        PERFORM sanctions_enqueue('patient', NEW.patient_id);
        IF TG_OP = 'UPDATE' AND NEW.patient_id IS DISTINCT FROM OLD.patient_id THEN
            PERFORM sanctions_enqueue('patient', OLD.patient_id);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sanctions_enqueue_patient_of_relation ON patient_relations;
CREATE TRIGGER trg_sanctions_enqueue_patient_of_relation
    AFTER INSERT OR UPDATE OR DELETE ON patient_relations
    FOR EACH ROW
    EXECUTE FUNCTION sanctions_enqueue_patient_of_relation();

-- An order or an invoice that names a relation as payer makes it an invoice
-- recipient: queue the relation's patient (and the patient of the relation it
-- named before).
CREATE OR REPLACE FUNCTION sanctions_enqueue_patient_of_payer_relation() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT'
        OR NEW.payer_patient_relation_id IS DISTINCT FROM OLD.payer_patient_relation_id
    THEN
        IF NEW.payer_patient_relation_id IS NOT NULL THEN
            PERFORM sanctions_enqueue('patient', r.patient_id)
            FROM patient_relations r
            WHERE r.id = NEW.payer_patient_relation_id;
        END IF;
        IF TG_OP = 'UPDATE' AND OLD.payer_patient_relation_id IS NOT NULL THEN
            PERFORM sanctions_enqueue('patient', r.patient_id)
            FROM patient_relations r
            WHERE r.id = OLD.payer_patient_relation_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sanctions_enqueue_patient_of_order_payer ON orders;
CREATE TRIGGER trg_sanctions_enqueue_patient_of_order_payer
    AFTER INSERT OR UPDATE OF payer_patient_relation_id ON orders
    FOR EACH ROW
    EXECUTE FUNCTION sanctions_enqueue_patient_of_payer_relation();

DROP TRIGGER IF EXISTS trg_sanctions_enqueue_patient_of_invoice_payer ON invoices;
CREATE TRIGGER trg_sanctions_enqueue_patient_of_invoice_payer
    AFTER INSERT OR UPDATE OF payer_patient_relation_id ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION sanctions_enqueue_patient_of_payer_relation();

-- A relation linked to a patient record is screened with that record's name,
-- birth date and citizenships: a change of them queues the patients whose
-- relations link to it as well. Same conditions as migration 20261004110000.
CREATE OR REPLACE FUNCTION sanctions_enqueue_patient() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT'
        OR NEW.first_name IS DISTINCT FROM OLD.first_name
        OR NEW.last_name IS DISTINCT FROM OLD.last_name
        OR NEW.birth_date IS DISTINCT FROM OLD.birth_date
        OR NEW.citizenships IS DISTINCT FROM OLD.citizenships
        OR NEW.nationality IS DISTINCT FROM OLD.nationality
        OR NEW.residence_country IS DISTINCT FROM OLD.residence_country
        OR NEW.address_country IS DISTINCT FROM OLD.address_country
        OR NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status
    THEN
        PERFORM sanctions_enqueue('patient', NEW.id);
        IF TG_OP = 'UPDATE' THEN
            PERFORM sanctions_enqueue('patient', r.patient_id)
            FROM patient_relations r
            WHERE r.related_patient_id = NEW.id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE INDEX IF NOT EXISTS idx_patient_relations_related_patient
    ON patient_relations (related_patient_id)
    WHERE related_patient_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_payer_relation
    ON orders (payer_patient_relation_id)
    WHERE payer_patient_relation_id IS NOT NULL;
