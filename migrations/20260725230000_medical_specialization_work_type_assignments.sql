ALTER TABLE medical_specializations
    ADD COLUMN name_es TEXT;

ALTER TABLE medical_specialization_work_types
    ADD COLUMN name_en TEXT,
    ADD COLUMN name_es TEXT,
    ADD COLUMN duration_hours INTEGER NOT NULL DEFAULT 1;

ALTER TABLE medical_specializations
    ADD CONSTRAINT medical_specializations_name_es_not_blank
        CHECK (name_es IS NULL OR btrim(name_es) <> '');

ALTER TABLE medical_specialization_work_types
    ADD CONSTRAINT medical_specialization_work_types_name_en_not_blank
        CHECK (name_en IS NULL OR btrim(name_en) <> ''),
    ADD CONSTRAINT medical_specialization_work_types_name_es_not_blank
        CHECK (name_es IS NULL OR btrim(name_es) <> ''),
    ADD CONSTRAINT medical_specialization_work_types_duration_hours_check
        CHECK (duration_hours BETWEEN 1 AND 50);

-- A catalog work type can be available under multiple medical specializations.
CREATE TABLE medical_specialization_work_type_assignments (
    work_type_id UUID NOT NULL
        REFERENCES medical_specialization_work_types(id) ON DELETE CASCADE,
    specialization_id UUID NOT NULL
        REFERENCES medical_specializations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (work_type_id, specialization_id)
);

INSERT INTO medical_specialization_work_type_assignments (
    work_type_id,
    specialization_id
)
SELECT id, specialization_id
FROM medical_specialization_work_types
WHERE deleted_at IS NULL
ON CONFLICT DO NOTHING;

CREATE INDEX idx_medical_specialization_work_type_assignments_specialization
    ON medical_specialization_work_type_assignments(specialization_id, work_type_id);
