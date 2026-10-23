-- The citizenships of a patient's relation (owner decision 2026-10-23): a
-- minor's repeat request takes the parents over from the patient record, and
-- so far asked their citizenships again because the relation kept none. The
-- lead conversion now writes the parent's citizenships (the lead
-- representative's, or a linked patient's) to the relation, and a repeat
-- request prefills its representatives from them.
--
-- A relation linked to a patient record keeps reading that record's
-- citizenships first; this column is the relation's own value.
ALTER TABLE patient_relations
    ADD COLUMN IF NOT EXISTS citizenships TEXT[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE patient_relations
    DROP CONSTRAINT IF EXISTS patient_relations_citizenships_iso_check,
    ADD CONSTRAINT patient_relations_citizenships_iso_check
        CHECK (array_to_string(citizenships, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$');

COMMENT ON COLUMN patient_relations.citizenships IS
    'ISO 3166-1 alpha-2 citizenships of the related person (written by the lead conversion from the lead representative); a linked patient record''s citizenships win';

-- Backfill from the converted leads: the representative row of the contact
-- the relation was made from (`source_contact_id`), the newest such row of a
-- lead converted to this patient.
UPDATE patient_relations pr
SET citizenships = source.citizenships
FROM (
    SELECT DISTINCT ON (pr2.id) pr2.id, lr.citizenships
    FROM patient_relations pr2
    JOIN lead_representatives lr ON lr.contact_id = pr2.source_contact_id
    JOIN leads l ON l.id = lr.lead_id AND l.converted_patient_id = pr2.patient_id
    WHERE cardinality(lr.citizenships) > 0
    ORDER BY pr2.id, lr.updated_at DESC
) source
WHERE pr.id = source.id
  AND pr.citizenships = '{}'::text[];
