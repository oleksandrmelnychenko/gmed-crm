-- An explicit, scoped disclosure decision made in the cabinet. No backfill:
-- an older list/Anlage 1 choice is not evidence of agreement to the new text.
ALTER TABLE consent_form_choices ADD COLUMN disclosure JSONB;
ALTER TABLE consent_form_choices ADD CONSTRAINT consent_form_disclosure_object
    CHECK (disclosure IS NULL OR jsonb_typeof(disclosure) = 'object');
COMMENT ON COLUMN consent_form_choices.disclosure IS
    'Immutable Auskunft an Dritte receipt: explicit decision/consent, text version and text, company, language, original actor/time. Copied unchanged when unrelated core/channel choices change.';

CREATE FUNCTION consent_form_disclosure_append_only() RETURNS trigger AS $$
BEGIN
    IF NEW.disclosure IS DISTINCT FROM OLD.disclosure THEN
        RAISE EXCEPTION 'A disclosure decision is never changed; save a new one'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_consent_form_disclosure_append_only
    BEFORE UPDATE ON consent_form_choices FOR EACH ROW
    EXECUTE FUNCTION consent_form_disclosure_append_only();
