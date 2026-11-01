-- DSGVO Art. 17 (QA 2026-11-01, X2 bug 1): the full name survived the erasure
-- in the version history of the record. The snapshots repeat what the record
-- once said; the record itself is scrubbed, its history was not.
--
-- patient_clinical_versions, case_versions and
-- patient_medication_import_history stay append-only. The exception is the
-- one the task history has (20261012160000_dsgvo_erasure_task_event_scrub.sql):
-- inside the erasure transaction (`gmed.dsgvo_erasure = on`), an UPDATE may
-- change text values of the snapshots, nothing else - same keys, same
-- structure, same numbers, flags and nulls, no other column. A DELETE stays as
-- it was. A version snapshot is not the audit log; audit_log is not widened
-- here. The erasure records the count in audit_log (`dsgvo_anonymize`,
-- counter `scrubbed_free_text.clinical_versions`).

-- gmed_jsonb_only_text_changed for a column that may be NULL: a NULL stays NULL.
CREATE OR REPLACE FUNCTION gmed_nullable_jsonb_only_text_changed(old_value JSONB, new_value JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT old_value IS NOT DISTINCT FROM new_value
        OR (old_value IS NOT NULL
            AND new_value IS NOT NULL
            AND gmed_jsonb_only_text_changed(old_value, new_value));
$$;

COMMENT ON FUNCTION gmed_nullable_jsonb_only_text_changed(JSONB, JSONB) IS
    'gmed_jsonb_only_text_changed for nullable columns: true when both are NULL or differ in text values only.';

CREATE OR REPLACE FUNCTION prevent_patient_clinical_version_mutation()
RETURNS TRIGGER AS $$
BEGIN
    -- Art. 17 DSGVO exception: only inside the erasure transaction, only an
    -- UPDATE, only text values of the snapshots.
    IF TG_OP = 'UPDATE'
       AND current_setting('gmed.dsgvo_erasure', true) = 'on'
       AND (to_jsonb(NEW) - 'old_value' - 'new_value') = (to_jsonb(OLD) - 'old_value' - 'new_value')
       AND gmed_nullable_jsonb_only_text_changed(OLD.old_value, NEW.old_value)
       AND gmed_nullable_jsonb_only_text_changed(OLD.new_value, NEW.new_value) THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE'
       AND EXISTS (
           SELECT 1
           FROM patients p
           JOIN leads l ON l.prospect_patient_id = p.id
           WHERE p.id = OLD.patient_id
             AND p.lifecycle_status = 'prospective'
             AND NOT p.is_active
             AND l.converted_patient_id IS NULL
             AND l.qualification_status <> 'converted'
       )
       AND NOT EXISTS (
           SELECT 1
           FROM leads converted_lead
           WHERE converted_lead.converted_patient_id = OLD.patient_id
              OR (
                  converted_lead.prospect_patient_id = OLD.patient_id
                  AND converted_lead.qualification_status = 'converted'
              )
       ) THEN
        RETURN OLD;
    END IF;

    RAISE EXCEPTION
        'patient_clinical_versions is immutable; updates and deletes are forbidden';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION prevent_patient_clinical_version_mutation() IS
    'Rejects every update and delete except explicit version cleanup for an existing unconverted prospective patient, and, inside a DSGVO erasure (gmed.dsgvo_erasure = on), an update of text values of the snapshots.';

CREATE OR REPLACE FUNCTION prevent_case_version_mutation()
RETURNS TRIGGER AS $$
BEGIN
    -- Art. 17 DSGVO exception: as for patient_clinical_versions.
    IF TG_OP = 'UPDATE'
       AND current_setting('gmed.dsgvo_erasure', true) = 'on'
       AND (to_jsonb(NEW) - 'old_value' - 'new_value') = (to_jsonb(OLD) - 'old_value' - 'new_value')
       AND gmed_nullable_jsonb_only_text_changed(OLD.old_value, NEW.old_value)
       AND gmed_nullable_jsonb_only_text_changed(OLD.new_value, NEW.new_value) THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'case_versions is immutable — updates and deletes are forbidden';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION prevent_case_version_mutation() IS
    'Keeps case_versions immutable; inside a DSGVO erasure (gmed.dsgvo_erasure = on) only text values of the snapshots may change.';

CREATE OR REPLACE FUNCTION prevent_patient_medication_import_history_update()
RETURNS TRIGGER AS $$
BEGIN
    -- Art. 17 DSGVO exception: the raw source line and the snapshots may name
    -- the patient; the fingerprints and identifiers of the evidence stay.
    IF current_setting('gmed.dsgvo_erasure', true) = 'on'
       AND (to_jsonb(NEW) - 'source_raw_text' - 'old_value' - 'new_value')
           = (to_jsonb(OLD) - 'source_raw_text' - 'old_value' - 'new_value')
       AND gmed_nullable_jsonb_only_text_changed(OLD.old_value, NEW.old_value)
       AND gmed_nullable_jsonb_only_text_changed(OLD.new_value, NEW.new_value) THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'patient_medication_import_history is immutable; append a new event instead';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION prevent_patient_medication_import_history_update() IS
    'Keeps the medication evidence immutable; inside a DSGVO erasure (gmed.dsgvo_erasure = on) only the raw source text and text values of the snapshots may change.';
