-- The relationship editor and the backend validator both offer "friend" as a
-- relation type, but the patient_relations CHECK constraint never included it
-- (only "caregiver" was added in 20260413131500). Selecting "Friend" passed app
-- validation and then violated the DB constraint, surfacing as a generic
-- "creation error". Allow "friend" so the constraint matches the application.
ALTER TABLE patient_relations
    DROP CONSTRAINT IF EXISTS patient_relations_relation_type_check;

ALTER TABLE patient_relations
    ADD CONSTRAINT patient_relations_relation_type_check
    CHECK (
        relation_type IN (
            'spouse',
            'parent',
            'child',
            'sibling',
            'relative',
            'guardian',
            'caregiver',
            'friend',
            'other'
        )
    );
