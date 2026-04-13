ALTER TABLE patient_feedback_forms
    ADD COLUMN IF NOT EXISTS organization_score INT CHECK (organization_score BETWEEN 1 AND 5),
    ADD COLUMN IF NOT EXISTS service_score INT CHECK (service_score BETWEEN 1 AND 5),
    ADD COLUMN IF NOT EXISTS infrastructure_score INT CHECK (infrastructure_score BETWEEN 1 AND 5),
    ADD COLUMN IF NOT EXISTS price_value_score INT CHECK (price_value_score BETWEEN 1 AND 5),
    ADD COLUMN IF NOT EXISTS treatment_success TEXT
        CHECK (treatment_success IN ('no', 'partial', 'yes')),
    ADD COLUMN IF NOT EXISTS complication_reported BOOLEAN NOT NULL DEFAULT false;
