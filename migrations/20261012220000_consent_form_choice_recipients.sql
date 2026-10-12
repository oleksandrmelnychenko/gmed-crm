-- The persons or institutions the person names in the lead cabinet for the
-- option "named_recipients" of the consent form (owner decision 2026-10-12):
-- name, who they are and how to reach them, at most five. They are part of
-- the choice: a changed list is a new row, and a form generated before is no
-- longer offered for an electronic signature (`consent_choice_changed`).
-- They are not sanctions-screened (owner decision 2026-10-12) and are not
-- trusted contacts of the lead.

ALTER TABLE consent_form_choices
    ADD COLUMN IF NOT EXISTS recipients JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE consent_form_choices
    DROP CONSTRAINT IF EXISTS consent_form_choices_recipients_check;
ALTER TABLE consent_form_choices
    ADD CONSTRAINT consent_form_choices_recipients_check
        CHECK (jsonb_typeof(recipients) = 'array' AND jsonb_array_length(recipients) <= 5);

COMMENT ON COLUMN consent_form_choices.recipients IS
    'Persons or institutions named for the option named_recipients: [{name, relation, contact}], at most 5; not sanctions-screened';

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
    THEN
        RAISE EXCEPTION 'A consent choice is never changed; save a new one'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
