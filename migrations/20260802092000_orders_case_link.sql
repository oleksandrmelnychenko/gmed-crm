-- Phase 7 of docs/case-patient-unification-strategy-ua.md (D8): honest order -> case seam.
-- cases.onboarding_order_id stays for now; both links coexist during the transition.

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS case_id UUID
        REFERENCES cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_case
    ON orders(case_id)
    WHERE case_id IS NOT NULL;

UPDATE orders o
SET case_id = c.id
FROM cases c
WHERE c.onboarding_order_id = o.id
  AND o.case_id IS NULL;
