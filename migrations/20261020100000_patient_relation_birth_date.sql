-- The date of birth of a relation that is not linked to a patient record
-- (owner decision 2026-10-19: a parent who contracts in their own name for a
-- minor is named with date of birth and address on the framework contract,
-- the single order and the child's consent form). The lead documents read it
-- from the lead's trusted contact; after the conversion the contracting
-- parents are patient relations, which so far kept the date only as free
-- text in `notes` ("Geburtsdatum: …"), and the documents lost the line.
--
-- A relation linked to a patient record keeps reading that record's date
-- (`services::contracting_party::load_relations`); this column is the
-- fallback. The lead conversion writes it from the trusted contact.
ALTER TABLE patient_relations
    ADD COLUMN IF NOT EXISTS birth_date DATE;

COMMENT ON COLUMN patient_relations.birth_date IS
    'Date of birth of the related person when no patient record is linked (written by the lead conversion from the trusted contact); a linked record''s birth date wins';

-- Backfill from the converted leads: a parent or guardian relation of the
-- converted patient whose name is the trusted contact's, only where all such
-- contacts of that name agree on one date. A text that is no valid date is
-- skipped and never fails the migration.
DO $$
DECLARE
    candidate RECORD;
BEGIN
    FOR candidate IN
        SELECT pr.id, min(btrim(c ->> 'birth_date')) AS birth_date
        FROM patient_relations pr
        JOIN leads l ON l.converted_patient_id = pr.patient_id
        CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(l.trusted_contacts) = 'array'
                 THEN l.trusted_contacts ELSE '[]'::jsonb END) c
        WHERE pr.birth_date IS NULL
          AND pr.relation_type IN ('parent', 'mother', 'father', 'guardian')
          AND lower(btrim(pr.related_name)) = lower(btrim(c ->> 'name'))
          AND btrim(c ->> 'birth_date') ~ '^\d{4}-\d{2}-\d{2}$'
        GROUP BY pr.id
        HAVING count(DISTINCT btrim(c ->> 'birth_date')) = 1
    LOOP
        BEGIN
            UPDATE patient_relations
            SET birth_date = candidate.birth_date::date
            WHERE id = candidate.id;
        EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
            NULL;
        END;
    END LOOP;
END $$;
