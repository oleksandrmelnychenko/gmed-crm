-- Several citizenships for every person the CRM records with identity data
-- (client decision 2026-11-02). Leads, patients, payers, representatives and
-- patient relations already keep ISO 3166-1 alpha-2 lists; this adds the
-- persons that had none and lets relation edits re-screen the patient.
-- Additive only: new columns with an empty default, no data rewritten.

-- 1. The signing representative of an organisation payer (payer link,
--    `lead_payer_statements.representative_*`). The beneficial owners keep
--    theirs inside the `beneficial_owners` JSON (`citizenships` per owner).
ALTER TABLE lead_payer_statements
    ADD COLUMN IF NOT EXISTS representative_citizenships TEXT[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE lead_payer_statements
    DROP CONSTRAINT IF EXISTS lead_payer_statements_representative_citizenships_iso_check,
    ADD CONSTRAINT lead_payer_statements_representative_citizenships_iso_check
        CHECK (array_to_string(representative_citizenships, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$');

COMMENT ON COLUMN lead_payer_statements.representative_citizenships IS
    'ISO 3166-1 alpha-2 citizenships of the organisation''s signing representative, as the payer stated them; sanctions-screened with the representative';

-- 2. Interpreters with a login (`interpreter_profile_details`). Standalone
--    staff profiles keep `citizenships` in their profile JSON.
ALTER TABLE interpreter_profile_details
    ADD COLUMN IF NOT EXISTS citizenships TEXT[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE interpreter_profile_details
    DROP CONSTRAINT IF EXISTS interpreter_profile_details_citizenships_iso_check,
    ADD CONSTRAINT interpreter_profile_details_citizenships_iso_check
        CHECK (array_to_string(citizenships, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$');

COMMENT ON COLUMN interpreter_profile_details.citizenships IS
    'ISO 3166-1 alpha-2 citizenships of the interpreter (several possible)';

-- 3. Staff now edit a relation's own birth date and citizenships in the
--    relation dialog; a separate contact is screened with them, so a change
--    queues the patient like the other screened relation fields (trigger of
--    migration 20261012061500).
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
        OR NEW.birth_date IS DISTINCT FROM OLD.birth_date
        OR NEW.citizenships IS DISTINCT FROM OLD.citizenships
    THEN
        PERFORM sanctions_enqueue('patient', NEW.patient_id);
        IF TG_OP = 'UPDATE' AND NEW.patient_id IS DISTINCT FROM OLD.patient_id THEN
            PERFORM sanctions_enqueue('patient', OLD.patient_id);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
