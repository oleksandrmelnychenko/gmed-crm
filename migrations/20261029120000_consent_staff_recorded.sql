-- Staff record the consent form options, the trusted persons and the
-- payer's cost-estimate consent the client gave them (owner decision
-- 2026-10-29), with how it was given: by phone, in person, by e-mail or on
-- paper, and an optional note.
ALTER TABLE consent_form_choices DROP CONSTRAINT IF EXISTS consent_form_choices_access_kind_check;
ALTER TABLE consent_form_choices ADD CONSTRAINT consent_form_choices_access_kind_check
    CHECK (access_kind IN ('self', 'guardian', 'staff'));
ALTER TABLE consent_form_choices DROP CONSTRAINT IF EXISTS consent_form_choices_source_check;
ALTER TABLE consent_form_choices ADD CONSTRAINT consent_form_choices_source_check
    CHECK (source IN ('lead_portal', 'staff_correction', 'staff_recorded'));
ALTER TABLE consent_form_choices ADD COLUMN IF NOT EXISTS recorded_how TEXT;
ALTER TABLE consent_form_choices ADD COLUMN IF NOT EXISTS recorded_note TEXT;
ALTER TABLE consent_form_choices DROP CONSTRAINT IF EXISTS consent_form_choices_recorded_check;
ALTER TABLE consent_form_choices ADD CONSTRAINT consent_form_choices_recorded_check
    CHECK ((source = 'staff_recorded') = (recorded_how IS NOT NULL));

ALTER TABLE lead_payer_declarations ADD COLUMN IF NOT EXISTS cost_estimate_consent_recorded_how TEXT;
ALTER TABLE lead_payer_declarations ADD COLUMN IF NOT EXISTS cost_estimate_consent_recorded_note TEXT;

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
        OR NEW.recorded_how IS DISTINCT FROM OLD.recorded_how
        OR NEW.recorded_note IS DISTINCT FROM OLD.recorded_note
    THEN
        RAISE EXCEPTION 'A consent choice is never changed; save a new one'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
