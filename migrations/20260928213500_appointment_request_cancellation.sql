-- An approved appointment request could stay "approved" forever when nobody
-- scheduled it. The patient can now withdraw an open request in the portal
-- and staff can cancel it with a reason; both end in the existing
-- `cancelled` status (owner decision 2026-09-28). Who cancelled it, when and
-- why is kept on the request (and in the audit log).
ALTER TABLE patient_appointment_requests
    ADD COLUMN cancelled_at TIMESTAMPTZ,
    ADD COLUMN cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN cancellation_reason TEXT,
    ADD COLUMN cancelled_by_patient BOOLEAN NOT NULL DEFAULT false;
