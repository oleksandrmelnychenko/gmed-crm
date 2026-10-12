-- The person's own choice of the options of the consent form
-- «Einverständniserklärung zur Datenübermittlung» (`privacy_consents`,
-- Anlage 1), 2026-10-12. See crates/server/src/consent_choices.rs and
-- docs/architecture/document-signatures-germany_ua.md.
--
-- The form prints its boxes empty since 2026-10-11; with an electronic
-- signature nobody can tick them. The lead chooses the options in the lead
-- cabinet; a generated form prints «[x]» only for those, with the date of the
-- choice, and only such a form is offered for an electronic signature.
--
-- Every save is a new row (history, append-only); the newest counts. Staff
-- never write a choice: only the lead cabinet (patient role) inserts rows.
-- Rows go with the lead (ON DELETE CASCADE, lead retention and erasure) and
-- with the patient record.

CREATE TABLE IF NOT EXISTS consent_form_choices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The order of the saves, independent of the clock: the newest counts.
    seq BIGINT GENERATED ALWAYS AS IDENTITY,
    template_id TEXT NOT NULL CHECK (template_id IN ('privacy_consents')),
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    choices JSONB NOT NULL CHECK (jsonb_typeof(choices) = 'object'),
    -- The login that chose (the lead's own or a parent's / guardian's).
    chosen_by UUID REFERENCES users(id) ON DELETE SET NULL,
    access_kind TEXT NOT NULL CHECK (access_kind IN ('self', 'guardian')),
    source TEXT NOT NULL CHECK (source IN ('lead_portal')),
    language TEXT NOT NULL,
    text_version TEXT NOT NULL,
    chosen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT consent_form_choices_owner_check
        CHECK (lead_id IS NOT NULL OR patient_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_consent_form_choices_lead
    ON consent_form_choices (lead_id, seq DESC)
    WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_consent_form_choices_patient
    ON consent_form_choices (patient_id, seq DESC)
    WHERE patient_id IS NOT NULL;

COMMENT ON TABLE consent_form_choices IS
    'The person''s own choice of the options of the consent form privacy_consents (lead cabinet); newest row counts; append-only';

-- A choice is history: it is never changed, only followed by a new one.
-- Deleting stays possible (lead purge, erasure); `chosen_by` is set NULL
-- when the login is removed.
CREATE OR REPLACE FUNCTION consent_form_choices_append_only() RETURNS trigger AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.seq IS DISTINCT FROM OLD.seq
        OR NEW.template_id IS DISTINCT FROM OLD.template_id
        OR NEW.choices IS DISTINCT FROM OLD.choices
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

DROP TRIGGER IF EXISTS trg_consent_form_choices_append_only ON consent_form_choices;
CREATE TRIGGER trg_consent_form_choices_append_only
    BEFORE UPDATE ON consent_form_choices
    FOR EACH ROW
    EXECUTE FUNCTION consent_form_choices_append_only();
