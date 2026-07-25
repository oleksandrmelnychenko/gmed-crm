ALTER TABLE medical_specialization_work_types
    DROP CONSTRAINT medical_specialization_work_types_duration_hours_check,
    ADD CONSTRAINT medical_specialization_work_types_duration_hours_check
        CHECK (duration_hours BETWEEN 1 AND 100);
