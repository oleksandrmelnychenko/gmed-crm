-- Patient diagnosis tree: nest diagnoses (main / secondary / prozedur) under a
-- parent diagnosis, and capture richer attribution + clinical qualifiers.
--
-- New columns:
--   parent_id          -> self-reference forming the tree; ON DELETE CASCADE so
--                         removing a parent removes its whole subtree.
--   certainty          -> diagnostic certainty (Verdacht / bestätigt / Zustand nach).
--   chronifizierung    -> acute / chronic / recurring.
--   source_mode        -> 'intern' (attributed to a provider+doctor in this system)
--                         vs 'extern' (free-text external clinic / doctor / country).
--   external_clinic / external_doctor / external_country -> extern attribution
--                         (external_country = ISO 3166-1 alpha-2).
--   treating_doctor_id -> the doctor currently treating this diagnosis (may differ
--                         from the diagnosing doctor); ON DELETE SET NULL.
--   treating_none      -> explicit "no treating doctor" flag.
--
-- The legacy `kind` CHECK only allowed ('main','secondary'); widen it to include
-- 'prozedur'. Legacy columns (grade, laterality, status) are retained for
-- back-compat; the new UI ignores them.

ALTER TABLE patient_diagnoses
    ADD COLUMN parent_id UUID REFERENCES patient_diagnoses(id) ON DELETE CASCADE,
    ADD COLUMN certainty TEXT,
    ADD COLUMN chronifizierung TEXT,
    ADD COLUMN source_mode TEXT NOT NULL DEFAULT 'intern',
    ADD COLUMN external_clinic TEXT,
    ADD COLUMN external_doctor TEXT,
    ADD COLUMN external_country TEXT,
    ADD COLUMN treating_doctor_id UUID REFERENCES provider_doctors(id) ON DELETE SET NULL,
    ADD COLUMN treating_none BOOLEAN NOT NULL DEFAULT false;

-- Widen the kind CHECK to allow the new 'prozedur' node type.
ALTER TABLE patient_diagnoses DROP CONSTRAINT IF EXISTS patient_diagnoses_kind_check;
ALTER TABLE patient_diagnoses
    ADD CONSTRAINT patient_diagnoses_kind_check
    CHECK (kind IN ('main', 'secondary', 'prozedur'));

ALTER TABLE patient_diagnoses
    ADD CONSTRAINT patient_diagnoses_certainty_check
    CHECK (certainty IS NULL OR certainty IN ('verdacht', 'bestaetigt', 'zustand_nach'));

ALTER TABLE patient_diagnoses
    ADD CONSTRAINT patient_diagnoses_chronifizierung_check
    CHECK (chronifizierung IS NULL OR chronifizierung IN ('akut', 'chronisch', 'rezidivierend'));

ALTER TABLE patient_diagnoses
    ADD CONSTRAINT patient_diagnoses_source_mode_check
    CHECK (source_mode IN ('intern', 'extern'));

-- Backfill existing rows: treat them as confirmed diagnoses, and map the legacy
-- 'chronic' status onto the new chronifizierung qualifier.
UPDATE patient_diagnoses
SET certainty = 'bestaetigt',
    chronifizierung = CASE WHEN status = 'chronic' THEN 'chronisch' ELSE NULL END
WHERE certainty IS NULL;

CREATE INDEX idx_patient_diagnoses_parent ON patient_diagnoses (parent_id);
