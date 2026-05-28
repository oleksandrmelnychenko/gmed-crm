ALTER TABLE concierge_services
    ADD COLUMN IF NOT EXISTS provider_service_id UUID REFERENCES service_catalog(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS quantity NUMERIC(12, 2) NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12, 2);

CREATE INDEX IF NOT EXISTS idx_concierge_services_provider_service
    ON concierge_services(provider_service_id);

UPDATE concierge_services
SET quantity = 1
WHERE quantity IS NULL OR quantity <= 0;
