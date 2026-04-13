ALTER TABLE operationen
    ADD COLUMN doctor_id UUID REFERENCES provider_doctors(id) ON DELETE SET NULL;

CREATE INDEX idx_operationen_doctor ON operationen(doctor_id);

ALTER TABLE medikamente
    ADD COLUMN verordnender_arzt_id UUID REFERENCES provider_doctors(id) ON DELETE SET NULL;

CREATE INDEX idx_medikamente_doctor ON medikamente(verordnender_arzt_id);
