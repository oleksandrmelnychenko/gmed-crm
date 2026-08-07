-- Move the remaining case-owned clinical residue toward the patient record.
--
-- This phase is deliberately forward-only and non-destructive:
--   * every legacy case_id is retained for compatibility/provenance;
--   * patient_id is backfilled from cases without merging or deleting rows;
--   * pain/symptom rows may be written directly for a patient going forward;
--   * tables whose case_id is still their primary key remain compatibility
--     tables until the dynamic specialty forms have a patient-owned schema.

ALTER TABLE pain_records
    ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES patients(id) ON DELETE CASCADE;
ALTER TABLE symptome
    ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES patients(id) ON DELETE CASCADE;
ALTER TABLE case_versions
    ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE case_cardiology_assessments
    ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES patients(id) ON DELETE CASCADE;
ALTER TABLE case_gastroenterology_assessments
    ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES patients(id) ON DELETE CASCADE;
ALTER TABLE case_orthopedics_assessments
    ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES patients(id) ON DELETE CASCADE;
ALTER TABLE case_neurology_assessments
    ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES patients(id) ON DELETE CASCADE;
ALTER TABLE case_pulmonology_assessments
    ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES patients(id) ON DELETE CASCADE;
ALTER TABLE case_urology_assessments
    ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES patients(id) ON DELETE CASCADE;

UPDATE pain_records AS source_row
SET patient_id = source.patient_id
FROM cases source
WHERE source_row.case_id = source.id
  AND source_row.patient_id IS NULL
  AND source.patient_id IS NOT NULL;

UPDATE symptome AS source_row
SET patient_id = source.patient_id
FROM cases source
WHERE source_row.case_id = source.id
  AND source_row.patient_id IS NULL
  AND source.patient_id IS NOT NULL;

-- case_versions has an immutability trigger. Disabling USER triggers is scoped
-- to this migration transaction and is used only for the provenance backfill.
ALTER TABLE case_versions DISABLE TRIGGER USER;
UPDATE case_versions AS source_row
SET patient_id = source.patient_id
FROM cases source
WHERE source_row.case_id = source.id
  AND source_row.patient_id IS NULL
  AND source.patient_id IS NOT NULL;
ALTER TABLE case_versions ENABLE TRIGGER USER;

UPDATE case_cardiology_assessments AS source_row
SET patient_id = source.patient_id
FROM cases source
WHERE source_row.case_id = source.id AND source_row.patient_id IS NULL AND source.patient_id IS NOT NULL;
UPDATE case_gastroenterology_assessments AS source_row
SET patient_id = source.patient_id
FROM cases source
WHERE source_row.case_id = source.id AND source_row.patient_id IS NULL AND source.patient_id IS NOT NULL;
UPDATE case_orthopedics_assessments AS source_row
SET patient_id = source.patient_id
FROM cases source
WHERE source_row.case_id = source.id AND source_row.patient_id IS NULL AND source.patient_id IS NOT NULL;
UPDATE case_neurology_assessments AS source_row
SET patient_id = source.patient_id
FROM cases source
WHERE source_row.case_id = source.id AND source_row.patient_id IS NULL AND source.patient_id IS NOT NULL;
UPDATE case_pulmonology_assessments AS source_row
SET patient_id = source.patient_id
FROM cases source
WHERE source_row.case_id = source.id AND source_row.patient_id IS NULL AND source.patient_id IS NOT NULL;
UPDATE case_urology_assessments AS source_row
SET patient_id = source.patient_id
FROM cases source
WHERE source_row.case_id = source.id AND source_row.patient_id IS NULL AND source.patient_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pain_records_patient
    ON pain_records(patient_id, sort_order) WHERE patient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_symptome_patient
    ON symptome(patient_id, sort_order) WHERE patient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_case_versions_patient
    ON case_versions(patient_id, created_at DESC) WHERE patient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_case_cardiology_patient
    ON case_cardiology_assessments(patient_id) WHERE patient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_case_gastroenterology_patient
    ON case_gastroenterology_assessments(patient_id) WHERE patient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_case_orthopedics_patient
    ON case_orthopedics_assessments(patient_id) WHERE patient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_case_neurology_patient
    ON case_neurology_assessments(patient_id) WHERE patient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_case_pulmonology_patient
    ON case_pulmonology_assessments(patient_id) WHERE patient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_case_urology_patient
    ON case_urology_assessments(patient_id) WHERE patient_id IS NOT NULL;

-- Keep the observed 1:1 relation visible and indexable without making deploys
-- fail in an environment that contains historical duplicate cases. Such
-- duplicates must be reconciled explicitly before a UNIQUE constraint is safe.
CREATE INDEX IF NOT EXISTS idx_cases_patient_created
    ON cases(patient_id, created_at, id) WHERE patient_id IS NOT NULL;

CREATE OR REPLACE FUNCTION sync_case_owned_patient_id()
RETURNS TRIGGER AS $$
DECLARE
    inferred_patient_id UUID;
BEGIN
    IF NEW.case_id IS NULL THEN
        IF NEW.patient_id IS NULL THEN
            RAISE EXCEPTION '% requires patient_id or legacy case_id', TG_TABLE_NAME;
        END IF;
        RETURN NEW;
    END IF;

    SELECT patient_id INTO inferred_patient_id
    FROM cases
    WHERE id = NEW.case_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Legacy case % does not exist', NEW.case_id;
    END IF;

    IF NEW.patient_id IS NULL THEN
        NEW.patient_id := inferred_patient_id;
    ELSIF inferred_patient_id IS NOT NULL AND NEW.patient_id <> inferred_patient_id THEN
        RAISE EXCEPTION 'patient_id does not match legacy case subject';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    table_name TEXT;
    trigger_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'pain_records', 'symptome', 'case_versions',
        'case_cardiology_assessments', 'case_gastroenterology_assessments',
        'case_orthopedics_assessments', 'case_neurology_assessments',
        'case_pulmonology_assessments', 'case_urology_assessments'
    ]
    LOOP
        trigger_name := table_name || '_sync_patient';
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', trigger_name, table_name);
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF case_id, patient_id ON %I '
            'FOR EACH ROW EXECUTE FUNCTION sync_case_owned_patient_id()',
            trigger_name, table_name
        );
    END LOOP;
END $$;

-- Pain and symptoms are explicitly retained product concepts. Their legacy
-- case link becomes optional and can no longer cascade-delete patient data.
ALTER TABLE pain_records ALTER COLUMN case_id DROP NOT NULL;
ALTER TABLE symptome ALTER COLUMN case_id DROP NOT NULL;

ALTER TABLE pain_records DROP CONSTRAINT IF EXISTS pain_records_case_id_fkey;
ALTER TABLE pain_records
    ADD CONSTRAINT pain_records_case_id_fkey
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE SET NULL;
ALTER TABLE symptome DROP CONSTRAINT IF EXISTS symptome_case_id_fkey;
ALTER TABLE symptome
    ADD CONSTRAINT symptome_case_id_fkey
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE SET NULL;

ALTER TABLE pain_records DROP CONSTRAINT IF EXISTS pain_records_subject_chk;
ALTER TABLE pain_records ADD CONSTRAINT pain_records_subject_chk
    CHECK (patient_id IS NOT NULL OR case_id IS NOT NULL) NOT VALID;
ALTER TABLE symptome DROP CONSTRAINT IF EXISTS symptome_subject_chk;
ALTER TABLE symptome ADD CONSTRAINT symptome_subject_chk
    CHECK (patient_id IS NOT NULL OR case_id IS NOT NULL) NOT VALID;
ALTER TABLE pain_records VALIDATE CONSTRAINT pain_records_subject_chk;
ALTER TABLE symptome VALIDATE CONSTRAINT symptome_subject_chk;

-- The remaining legacy tables cannot safely SET NULL because case_id is still
-- their primary key. RESTRICT prevents an accidental case deletion from
-- cascading into clinical/audit loss while the patient-owned replacement is
-- designed and reconciled.
ALTER TABLE case_versions DROP CONSTRAINT IF EXISTS case_versions_case_id_fkey;
ALTER TABLE case_versions ADD CONSTRAINT case_versions_case_id_fkey
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE RESTRICT;
ALTER TABLE case_cardiology_assessments DROP CONSTRAINT IF EXISTS case_cardiology_assessments_case_id_fkey;
ALTER TABLE case_cardiology_assessments ADD CONSTRAINT case_cardiology_assessments_case_id_fkey
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE RESTRICT;
ALTER TABLE case_gastroenterology_assessments DROP CONSTRAINT IF EXISTS case_gastroenterology_assessments_case_id_fkey;
ALTER TABLE case_gastroenterology_assessments ADD CONSTRAINT case_gastroenterology_assessments_case_id_fkey
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE RESTRICT;
ALTER TABLE case_orthopedics_assessments DROP CONSTRAINT IF EXISTS case_orthopedics_assessments_case_id_fkey;
ALTER TABLE case_orthopedics_assessments ADD CONSTRAINT case_orthopedics_assessments_case_id_fkey
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE RESTRICT;
ALTER TABLE case_neurology_assessments DROP CONSTRAINT IF EXISTS case_neurology_assessments_case_id_fkey;
ALTER TABLE case_neurology_assessments ADD CONSTRAINT case_neurology_assessments_case_id_fkey
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE RESTRICT;
ALTER TABLE case_pulmonology_assessments DROP CONSTRAINT IF EXISTS case_pulmonology_assessments_case_id_fkey;
ALTER TABLE case_pulmonology_assessments ADD CONSTRAINT case_pulmonology_assessments_case_id_fkey
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE RESTRICT;
ALTER TABLE case_urology_assessments DROP CONSTRAINT IF EXISTS case_urology_assessments_case_id_fkey;
ALTER TABLE case_urology_assessments ADD CONSTRAINT case_urology_assessments_case_id_fkey
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE RESTRICT;

COMMENT ON COLUMN pain_records.case_id IS
    'Nullable legacy provenance only; patient_id is the canonical owner.';
COMMENT ON COLUMN symptome.case_id IS
    'Nullable legacy provenance only; patient_id is the canonical owner.';
COMMENT ON COLUMN case_versions.patient_id IS
    'Patient owner backfilled from cases; use patient_clinical_versions for new writes.';
