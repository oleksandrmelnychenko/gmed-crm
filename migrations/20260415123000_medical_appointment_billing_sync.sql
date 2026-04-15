ALTER TABLE order_leistungen
    ADD COLUMN IF NOT EXISTS source_medical_appointment_id UUID REFERENCES appointments(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ol_source_medical_appointment_id
    ON order_leistungen(source_medical_appointment_id)
    WHERE source_medical_appointment_id IS NOT NULL;
