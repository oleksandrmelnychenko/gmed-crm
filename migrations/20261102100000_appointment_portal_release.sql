-- The patient sees an appointment in the portal only once the plan is
-- released to him (owner decision 2026-11-02, Excel "Nur freigegebene Termine
-- sehen"). Null = staff still plan it; the portal, the dashboard, realtime
-- events and the portal export skip the row.
--
-- The default keeps every insert path that does not decide (appointment
-- request conversion, fixtures) released, as before; only an appointment
-- created inside an order starts unreleased, set explicitly by the server.
ALTER TABLE appointments
    ADD COLUMN portal_released_at TIMESTAMPTZ DEFAULT now(),
    ADD COLUMN portal_released_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Existing appointments count as released, since they were created. The
-- backfill is no edit of the visit: updated_at stays.
ALTER TABLE appointments DISABLE TRIGGER set_updated_at_apt;
UPDATE appointments SET portal_released_at = created_at;
ALTER TABLE appointments ENABLE TRIGGER set_updated_at_apt;

CREATE INDEX idx_appointments_order_portal_unreleased
    ON appointments (order_id)
    WHERE portal_released_at IS NULL;
