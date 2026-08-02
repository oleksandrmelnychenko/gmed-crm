-- Identity-first intake: patients carry a lifecycle status, leads point at the
-- prospect patient they created and declare which intake model they follow.
-- See docs/case-patient-unification-strategy-ua.md (D1-D3).

-- 1) Patient lifecycle. Backfill maps the legacy is_active flag; is_active
--    stays dual-written (true only for lifecycle 'active') until readers move.
ALTER TABLE patients
    ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'active';

UPDATE patients
SET lifecycle_status = 'inactive'
WHERE NOT is_active
  AND lifecycle_status = 'active';

ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_lifecycle_status_check;
ALTER TABLE patients ADD CONSTRAINT patients_lifecycle_status_check
    CHECK (lifecycle_status IN ('prospective', 'active', 'inactive', 'deleted'));

CREATE INDEX IF NOT EXISTS idx_patients_lifecycle_status
    ON patients(lifecycle_status);

-- 2) Lead -> prospect pointer. Conversion promotes this patient in place.
ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS prospect_patient_id UUID REFERENCES patients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_prospect_patient
    ON leads(prospect_patient_id)
    WHERE prospect_patient_id IS NOT NULL;

-- 3) Intake model discriminator. Existing leads keep the legacy copy-on-convert
--    path; new leads write clinical data straight to the prospect patient.
ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS intake_model TEXT;

UPDATE leads
SET intake_model = 'legacy'
WHERE intake_model IS NULL;

ALTER TABLE leads ALTER COLUMN intake_model SET DEFAULT 'patient_first';
ALTER TABLE leads ALTER COLUMN intake_model SET NOT NULL;

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_intake_model_check;
ALTER TABLE leads ADD CONSTRAINT leads_intake_model_check
    CHECK (intake_model IN ('legacy', 'patient_first'));

-- 4) Funnel provenance for cases created on a prospect patient. Mirrors
--    orders.source_lead_id; lets the wizard find "its" case without the
--    lead_id XOR subject hack (which patient_first cases no longer use).
ALTER TABLE cases
    ADD COLUMN IF NOT EXISTS source_lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cases_source_lead_unique
    ON cases(source_lead_id)
    WHERE source_lead_id IS NOT NULL;

UPDATE cases
SET source_lead_id = lead_id
WHERE lead_id IS NOT NULL
  AND source_lead_id IS NULL;
