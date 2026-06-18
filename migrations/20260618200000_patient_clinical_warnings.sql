-- Phase 5: replace the single free-text patients.clinical_warnings column
-- (surfaced as "Allergien/CAVE" in the overview card) with two multi-entry
-- CRUD lists backed by one table. `kind` discriminates allergy rows from CAVE
-- warnings; allergy-only fields (reaction, severity) are simply left NULL for
-- CAVE rows.
--
-- The legacy patients.clinical_warnings column is intentionally KEPT: the
-- patient-update endpoint still writes it, so dropping it would break that
-- path. We only read it once here to backfill existing data.

CREATE TABLE patient_clinical_warnings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('allergie', 'cave')),
    label TEXT NOT NULL,
    reaction TEXT,
    severity TEXT,
    note TEXT,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_patient_clinical_warnings_patient_kind
    ON patient_clinical_warnings (patient_id, kind);

-- Backfill: split each patient's existing free-text clinical_warnings on
-- newline / comma / semicolon, trim whitespace, skip empty fragments, and seed
-- them as `allergie` rows. WITH ORDINALITY preserves the original ordering so
-- sort_order reflects the order the entries appeared in the source text.
INSERT INTO patient_clinical_warnings (patient_id, kind, label, sort_order)
SELECT
    p.id,
    'allergie',
    trimmed.label,
    (ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY parts.ord) - 1)::int
FROM patients p
CROSS JOIN LATERAL regexp_split_to_table(p.clinical_warnings, '[\n,;]')
    WITH ORDINALITY AS parts(fragment, ord)
CROSS JOIN LATERAL (SELECT btrim(parts.fragment) AS label) AS trimmed
WHERE p.clinical_warnings IS NOT NULL
  AND trimmed.label <> '';
