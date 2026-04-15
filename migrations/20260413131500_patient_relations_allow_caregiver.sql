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
            'other'
        )
    );
