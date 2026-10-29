-- Staff correct the data of a person the patient named for "Auskunft an
-- Dritte" (Anlage 1) or record the patient's withdrawal for that person
-- (owner decision 2026-10-29). A correction is a new choice row: the
-- patient's choice, chooser and time stay, the recipients change, and who
-- corrected it, when and why is kept with the row.
ALTER TABLE consent_form_choices DROP CONSTRAINT IF EXISTS consent_form_choices_source_check;
ALTER TABLE consent_form_choices ADD CONSTRAINT consent_form_choices_source_check
    CHECK (source IN ('lead_portal', 'staff_correction'));

ALTER TABLE consent_form_choices ADD COLUMN IF NOT EXISTS corrected_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE consent_form_choices ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ;
ALTER TABLE consent_form_choices ADD COLUMN IF NOT EXISTS correction_reason TEXT;

ALTER TABLE consent_form_choices DROP CONSTRAINT IF EXISTS consent_form_choices_correction_check;
ALTER TABLE consent_form_choices ADD CONSTRAINT consent_form_choices_correction_check
    CHECK ((source = 'staff_correction') = (corrected_at IS NOT NULL AND correction_reason IS NOT NULL));

CREATE OR REPLACE FUNCTION consent_form_choices_append_only() RETURNS trigger AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.seq IS DISTINCT FROM OLD.seq
        OR NEW.template_id IS DISTINCT FROM OLD.template_id
        OR NEW.choices IS DISTINCT FROM OLD.choices
        OR NEW.recipients IS DISTINCT FROM OLD.recipients
        OR NEW.access_kind IS DISTINCT FROM OLD.access_kind
        OR NEW.source IS DISTINCT FROM OLD.source
        OR NEW.language IS DISTINCT FROM OLD.language
        OR NEW.text_version IS DISTINCT FROM OLD.text_version
        OR NEW.chosen_at IS DISTINCT FROM OLD.chosen_at
        OR (NEW.chosen_by IS DISTINCT FROM OLD.chosen_by AND NEW.chosen_by IS NOT NULL)
        OR (NEW.lead_id IS DISTINCT FROM OLD.lead_id AND NEW.lead_id IS NOT NULL)
        OR (NEW.patient_id IS DISTINCT FROM OLD.patient_id AND OLD.patient_id IS NOT NULL)
        OR (NEW.corrected_by IS DISTINCT FROM OLD.corrected_by AND NEW.corrected_by IS NOT NULL)
        OR NEW.corrected_at IS DISTINCT FROM OLD.corrected_at
        OR NEW.correction_reason IS DISTINCT FROM OLD.correction_reason
    THEN
        RAISE EXCEPTION 'A consent choice is never changed; save a new one'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
