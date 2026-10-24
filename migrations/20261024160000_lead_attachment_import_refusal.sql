-- A questionnaire attachment the import into the lead's documents refused
-- for its content (an unsupported or mismatching file type, a malware hit):
-- recorded on the row, so the next import does not try it again and the
-- wizard can name the file and the reason. A scanner that did not answer is
-- never recorded here (the import fails as a whole and is retried). The rows
-- go with the lead as before (ON DELETE CASCADE).
ALTER TABLE lead_attachments
    ADD COLUMN IF NOT EXISTS import_refused_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS import_refusal_code TEXT;
