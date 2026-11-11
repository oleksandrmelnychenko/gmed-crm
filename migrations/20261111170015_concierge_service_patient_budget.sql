-- Owner decision 2026-11-11: the patient sees the budget they typed into
-- their own portal service request («Ваш бюджет»). Until now that budget was
-- stored as `cost_estimate`, which staff overwrite with their own estimate and
-- which the portal no longer shows (internal calculation, release QA S2-1).
-- The budget gets its own column: the portal request fills it, staff read it
-- and never change it, and `cost_estimate` stays the internal staff estimate.
--
-- No backfill. Whether staff ever changed the `cost_estimate` of an existing
-- portal request cannot be told reliably: the update audit event carries no
-- amounts, several paths write the estimate (service form, task sync,
-- applied partner quotes) and every update — also the automatic task link
-- right after the request — moves `updated_at`. Existing rows keep their
-- value in `cost_estimate` (staff-only); their patient budget stays empty.
-- No data is changed or deleted.

ALTER TABLE concierge_services
    ADD COLUMN patient_budget NUMERIC(12, 2)
        CHECK (patient_budget IS NULL OR patient_budget >= 0);

COMMENT ON COLUMN concierge_services.patient_budget IS
    'The patient''s own budget from a portal service request; shown to the patient, read-only for staff.';
COMMENT ON COLUMN concierge_services.cost_estimate IS
    'Internal staff estimate of the service; never sent to the patient portal.';
