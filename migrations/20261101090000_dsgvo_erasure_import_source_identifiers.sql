-- DSGVO Art. 17 (QA 2026-11-01, Y3 BUG-2): patient_medication_import_history.
-- source_identifiers is a free JSON object of the import's caller, so a name
-- can land there, and the guard refused it even inside the erasure. The
-- exception of 20261101083100_dsgvo_erasure_clinical_history_scrub.sql widens
-- to this column under the same rule: only an UPDATE, only with
-- `gmed.dsgvo_erasure = on`, only text values - same keys, same structure,
-- same numbers, flags and nulls.
CREATE OR REPLACE FUNCTION prevent_patient_medication_import_history_update()
RETURNS TRIGGER AS $$
BEGIN
    -- Art. 17 DSGVO exception: the raw source line, the snapshots and the
    -- identifiers may name the patient; the fingerprints stay.
    IF current_setting('gmed.dsgvo_erasure', true) = 'on'
       AND (to_jsonb(NEW) - 'source_raw_text' - 'old_value' - 'new_value' - 'source_identifiers')
           = (to_jsonb(OLD) - 'source_raw_text' - 'old_value' - 'new_value' - 'source_identifiers')
       AND gmed_nullable_jsonb_only_text_changed(OLD.old_value, NEW.old_value)
       AND gmed_nullable_jsonb_only_text_changed(OLD.new_value, NEW.new_value)
       AND gmed_nullable_jsonb_only_text_changed(OLD.source_identifiers, NEW.source_identifiers) THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'patient_medication_import_history is immutable; append a new event instead';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION prevent_patient_medication_import_history_update() IS
    'Keeps the medication evidence immutable; inside a DSGVO erasure (gmed.dsgvo_erasure = on) only the raw source text and text values of the snapshots and of source_identifiers may change.';
