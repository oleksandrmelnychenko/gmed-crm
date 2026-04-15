ALTER TABLE order_leistungen
    ADD COLUMN IF NOT EXISTS source_interpreter_report_id UUID REFERENCES interpreter_reports(id),
    ADD COLUMN IF NOT EXISTS agency_service_id UUID REFERENCES agency_service_catalog(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ol_source_interpreter_report
    ON order_leistungen(source_interpreter_report_id)
    WHERE source_interpreter_report_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ol_agency_service
    ON order_leistungen(agency_service_id)
    WHERE agency_service_id IS NOT NULL;
