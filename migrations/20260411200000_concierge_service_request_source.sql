ALTER TABLE concierge_services
    ADD COLUMN request_source TEXT NOT NULL DEFAULT 'staff'
    CHECK (request_source IN ('staff', 'patient_portal', 'appointment_bootstrap'));

CREATE INDEX idx_concierge_services_request_source
    ON concierge_services(request_source);
