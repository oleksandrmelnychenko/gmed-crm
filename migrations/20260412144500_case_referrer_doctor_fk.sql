ALTER TABLE cases
    ADD COLUMN zuweiser_doctor_id UUID REFERENCES provider_doctors(id) ON DELETE SET NULL;

CREATE INDEX idx_cases_referrer_doctor ON cases(zuweiser_doctor_id);
