-- Staff enter or correct a third-party payer's payment route in the lead
-- wizard (owner 2026-10-26, POST /leads/{id}/payer-declaration/payment-route).
-- Section 8 stays one set of columns on `lead_payer_declarations`; this
-- column says who wrote it last: `payer` (the payer link) or `staff` (the
-- wizard). The last writer wins. A write that changes the route without
-- naming an author (the lead's cabinet) leaves it NULL.
--
-- Additive and safe on existing data: existing rows stay NULL; a third
-- party's route of before came from the payer link and is shown as such.
ALTER TABLE lead_payer_declarations
    ADD COLUMN IF NOT EXISTS payment_route_entered_by TEXT
        CHECK (payment_route_entered_by IS NULL OR payment_route_entered_by IN ('payer', 'staff'));

COMMENT ON COLUMN lead_payer_declarations.payment_route_entered_by IS
    'Who wrote the payment route (section 8) last: payer (payer link) or staff (lead wizard); NULL for the cabinet or before 2026-10-26.';
