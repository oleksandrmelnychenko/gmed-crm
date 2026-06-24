-- Case medications now use the shared German medication-form reference list
-- (AMP, TABL, AUGT, etc.). The original case table only accepted a small
-- legacy enum, so valid catalog values failed at save time.
ALTER TABLE medikamente
    DROP CONSTRAINT IF EXISTS medikamente_darreichungsform_check;
