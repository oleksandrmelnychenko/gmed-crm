-- Phase 2 — Anamnese versioning.
--
-- patient_clinical_narrative was one row per patient (patient_id PRIMARY KEY).
-- It now becomes a versioned, multi-row-per-patient table: each row is a saved
-- version of the Anamnese, with exactly one active version per patient enforced
-- by a partial unique index. The previous single row migrates to is_active=true.
--
-- The untersuchungsbefund column is intentionally kept (now unused by the UI/API).

-- New surrogate key. The volatile uuid_generate_v4() default fills the existing
-- rows with distinct ids so we can promote it to PRIMARY KEY.
ALTER TABLE patient_clinical_narrative
    ADD COLUMN id UUID NOT NULL DEFAULT uuid_generate_v4();

-- Active flag. Existing rows become the active version of their patient.
ALTER TABLE patient_clinical_narrative
    ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;

-- Creation timestamp. Existing rows backfill from updated_at; new rows default
-- to now(). Surfaced read-only in the API alongside updated_at.
ALTER TABLE patient_clinical_narrative
    ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE patient_clinical_narrative SET created_at = updated_at;

-- patient_id stops being the primary key but stays a NOT NULL FK column
-- (it already REFERENCES patients(id) ON DELETE CASCADE).
ALTER TABLE patient_clinical_narrative
    DROP CONSTRAINT patient_clinical_narrative_pkey;
ALTER TABLE patient_clinical_narrative
    ADD PRIMARY KEY (id);

-- Only one active version per patient.
CREATE UNIQUE INDEX uniq_active_narrative
    ON patient_clinical_narrative (patient_id)
    WHERE is_active;

-- Fast lookup / history listing per patient.
CREATE INDEX idx_narrative_patient
    ON patient_clinical_narrative (patient_id);
