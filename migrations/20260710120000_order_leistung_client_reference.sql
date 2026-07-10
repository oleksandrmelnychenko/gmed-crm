-- Retry-safe client reference for multi-step writers such as the lead wizard.
-- PostgreSQL UNIQUE indexes allow multiple NULL values, so existing/manual
-- service lines keep their current behaviour.
ALTER TABLE order_leistungen
    ADD COLUMN IF NOT EXISTS client_reference TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_order_leistungen_client_reference
    ON order_leistungen (order_id, client_reference);
