-- Contracting representatives have their own neutral follow-up answers.
-- Existing answers and signed documents are deliberately not backfilled.
ALTER TABLE lead_representatives
    ADD COLUMN IF NOT EXISTS country_questions JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(country_questions) = 'object');

ALTER TABLE lead_risk_assessments
    ADD COLUMN IF NOT EXISTS representative_country_ids UUID[] NOT NULL DEFAULT '{}'::uuid[];

ALTER TABLE lead_risk_assessments
    DROP CONSTRAINT IF EXISTS lead_risk_assessments_requested_blocks_check;
ALTER TABLE lead_risk_assessments
    ADD CONSTRAINT lead_risk_assessments_requested_blocks_check CHECK (
        requested_blocks <@ ARRAY['A','B','C','D','E','F','G','H','I','J','K','L','R']::text[]
    );
ALTER TABLE lead_risk_decisions
    DROP CONSTRAINT IF EXISTS lead_risk_decisions_blocks_check;
ALTER TABLE lead_risk_decisions
    ADD CONSTRAINT lead_risk_decisions_blocks_check CHECK (
        blocks <@ ARRAY['A','B','C','D','E','F','G','H','I','J','K','L','R']::text[]
    );

-- A parent explicitly linked to an existing patient may have no copied
-- representative row. Changes to that canonical identity re-screen the child.
CREATE OR REPLACE FUNCTION sanctions_enqueue_linked_guardian_leads() RETURNS trigger AS $$
DECLARE child_id UUID;
BEGIN
    IF NEW.first_name IS DISTINCT FROM OLD.first_name
       OR NEW.last_name IS DISTINCT FROM OLD.last_name
       OR NEW.birth_date IS DISTINCT FROM OLD.birth_date
       OR NEW.citizenships IS DISTINCT FROM OLD.citizenships
       OR NEW.nationality IS DISTINCT FROM OLD.nationality
       OR NEW.residence_country IS DISTINCT FROM OLD.residence_country
       OR NEW.address_country IS DISTINCT FROM OLD.address_country
       OR NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status
       OR NEW.legal_status IS DISTINCT FROM OLD.legal_status THEN
        FOR child_id IN
            SELECT l.id FROM leads l
            WHERE EXISTS (
                SELECT 1 FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(l.trusted_contacts) = 'array'
                         THEN l.trusted_contacts ELSE '[]'::jsonb END
                ) contact
                WHERE contact->>'related_patient_id' = NEW.id::text
            )
        LOOP
            PERFORM sanctions_enqueue('lead', child_id);
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sanctions_enqueue_linked_guardian_leads ON patients;
CREATE TRIGGER trg_sanctions_enqueue_linked_guardian_leads
    AFTER UPDATE ON patients FOR EACH ROW
    EXECUTE FUNCTION sanctions_enqueue_linked_guardian_leads();
