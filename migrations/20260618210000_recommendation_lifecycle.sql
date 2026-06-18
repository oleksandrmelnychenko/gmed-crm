-- Phase 4: Empfehlungen lifecycle + admin CRUD.
--
-- This is ADDITIVE on top of the existing patient_recommendations table
-- (migration 20260501100000_patient_recommendations.sql). The legacy
-- status / portal_visible / patient_decision lifecycle and the patient-portal
-- decision handlers are left untouched. We add a parallel staff-facing
-- lifecycle (`lifecycle_status`) plus validity / reminder / outcome metadata.
--
-- Dates are stored as TEXT in YYYY-MM-DD form (matching how the frontend posts
-- bare date inputs); reminder_lead_days is an integer day count.

ALTER TABLE patient_recommendations
    ADD COLUMN IF NOT EXISTS recommended_on TEXT,
    ADD COLUMN IF NOT EXISTS valid_from TEXT,
    ADD COLUMN IF NOT EXISTS valid_to TEXT,
    ADD COLUMN IF NOT EXISTS reminder_lead_days INT,
    ADD COLUMN IF NOT EXISTS reminder_at TEXT,
    ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'aktiv',
    ADD COLUMN IF NOT EXISTS outcome_note TEXT,
    ADD COLUMN IF NOT EXISTS outcome_at TEXT,
    ADD COLUMN IF NOT EXISTS note_intern TEXT;

ALTER TABLE patient_recommendations
    DROP CONSTRAINT IF EXISTS patient_recommendations_lifecycle_status_check;

ALTER TABLE patient_recommendations
    ADD CONSTRAINT patient_recommendations_lifecycle_status_check
    CHECK (lifecycle_status IN ('aktiv', 'erfolg', 'nicht_erfolgt', 'unbekannt'));

CREATE INDEX IF NOT EXISTS idx_patient_recommendations_lifecycle
    ON patient_recommendations(patient_id, lifecycle_status, created_at DESC);
