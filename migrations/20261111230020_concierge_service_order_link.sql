-- QA 2026-11-11 L1: a concierge service booked on the Services page can be
-- linked to an order of the same patient. Until now a service reached an
-- order only through a non-medical appointment, so a confirmed booking did
-- not clear the order's «non-medical services» planning blocker, and staff
-- created a second, duplicate service through an appointment.
--
-- A service linked through its appointment keeps `order_id` NULL (the
-- appointment's order counts); a direct link names the order here.
ALTER TABLE concierge_services
    ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id) ON DELETE SET NULL;

COMMENT ON COLUMN concierge_services.order_id IS
    'The order this service belongs to when it is linked directly (Services page or the order''s planning blocker). A service with an appointment belongs to the appointment''s order.';

CREATE INDEX IF NOT EXISTS idx_concierge_services_order
    ON concierge_services (order_id)
    WHERE order_id IS NOT NULL;
