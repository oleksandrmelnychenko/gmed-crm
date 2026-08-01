ALTER TABLE cases
    ADD COLUMN IF NOT EXISTS onboarding_order_id UUID
        REFERENCES orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cases_onboarding_order_id
    ON cases(onboarding_order_id)
    WHERE onboarding_order_id IS NOT NULL;
