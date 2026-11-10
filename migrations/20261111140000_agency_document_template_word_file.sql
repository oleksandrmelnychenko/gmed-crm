-- A Word template is printed from its own file, so that the document looks
-- as it does in Word under the GMED letterhead (owner decision 2026-11-10).
-- The file (at most 2 MB) is kept with the template version; a text template
-- and the versions imported before this have none and print as text.
ALTER TABLE agency_document_templates
    ADD COLUMN IF NOT EXISTS source_docx BYTEA NULL;
