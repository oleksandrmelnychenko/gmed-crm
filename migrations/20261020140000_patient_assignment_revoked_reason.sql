-- Why a patient link was revoked, when the system revoked it without a person
-- (owner decision 2026-10-20: a minor patient turns 18). The daily
-- coming-of-age job (`services::coming_of_age`) ends the parents' access to
-- the record of a converted minor (`source = 'lead_guardian'`) on the 18th
-- birthday and records `patient_came_of_age` here, with `revoked_by` NULL.
--
-- The value is set by the same statement as `revoked_at` and describes only
-- the current revocation: a later grant clears `revoked_at`, after which the
-- reason no longer applies. The append-only audit log keeps the history.
ALTER TABLE patient_assignments
    ADD COLUMN IF NOT EXISTS revoked_reason TEXT;

COMMENT ON COLUMN patient_assignments.revoked_reason IS
    'Reason of the current revocation when the system revoked the link (e.g. patient_came_of_age); meaningful only while revoked_at is set.';

-- The job looks for active parents' links of converted minors.
CREATE INDEX IF NOT EXISTS idx_pa_active_lead_guardian
    ON patient_assignments (patient_id)
    WHERE source = 'lead_guardian' AND revoked_at IS NULL;
