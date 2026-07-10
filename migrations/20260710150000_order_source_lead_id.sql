-- Preserve the lead that originated a wizard-created order. The partial unique
-- index turns retries of the final wizard steps into a single order.
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS source_lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_source_lead_unique
    ON orders (source_lead_id)
    WHERE source_lead_id IS NOT NULL;
