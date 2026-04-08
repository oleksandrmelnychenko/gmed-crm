ALTER TABLE appointments
    ADD COLUMN doctor_id UUID REFERENCES provider_doctors(id);

CREATE INDEX idx_apt_doctor ON appointments(doctor_id);

ALTER TABLE order_leistungen
    ADD COLUMN doctor_id UUID REFERENCES provider_doctors(id);

CREATE INDEX idx_ol_doctor ON order_leistungen(doctor_id);
