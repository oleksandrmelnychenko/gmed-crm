-- Internal notes get a visibility chosen by the author (owner decision
-- 2026-10-12, QA E-23): only the author ('private'), the author's role
-- ('role') or all staff ('staff'). The CEO reads every note.
--
-- Notes written before this change were visible to all staff; they keep that
-- visibility so nothing disappears. New notes default to 'private'.
ALTER TABLE internal_notes
    ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'staff',
    ADD COLUMN IF NOT EXISTS visible_role TEXT;

ALTER TABLE internal_notes
    ALTER COLUMN visibility SET DEFAULT 'private';

ALTER TABLE internal_notes
    DROP CONSTRAINT IF EXISTS internal_notes_visibility_check;
ALTER TABLE internal_notes
    ADD CONSTRAINT internal_notes_visibility_check
        CHECK (
            visibility IN ('private', 'role', 'staff')
            AND (visibility <> 'role' OR NULLIF(BTRIM(visible_role), '') IS NOT NULL)
        );

COMMENT ON COLUMN internal_notes.visibility IS
    'Who reads the note: private (author only), role (visible_role), staff (all staff). The CEO reads every note.';
COMMENT ON COLUMN internal_notes.visible_role IS
    'The author''s role when the note was shared with that role (visibility = role).';
