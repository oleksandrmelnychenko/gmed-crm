-- Clinical document imports (owner decision 2026-09-28, Q10).
--
-- 1. The parser counts its claims: a job whose worker never finished is
--    claimed again after its lease, at most three times, then it fails with
--    CLINICAL_DOCUMENT_PARSER_ATTEMPTS_EXHAUSTED (services/clinical-document-
--    parser/app/worker.py). Retry and rescan start the count again.
-- 2. An import stuck in `applying` (the browser-driven apply stopped halfway)
--    can be abandoned with a reason: terminal status `abandoned`. Clinical rows
--    already written from it stay (they are part of the record now) and can be
--    corrected like rows of an applied import; the document can be imported
--    again.
ALTER TABLE clinical_document_imports
    ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS abandoned_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS abandoned_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS abandon_reason TEXT;

ALTER TABLE clinical_document_imports
    DROP CONSTRAINT IF EXISTS clinical_document_imports_attempts_check,
    ADD CONSTRAINT clinical_document_imports_attempts_check CHECK (attempts >= 0);

ALTER TABLE clinical_document_imports
    DROP CONSTRAINT IF EXISTS clinical_document_imports_status_check,
    ADD CONSTRAINT clinical_document_imports_status_check CHECK (
        status IN ('queued', 'processing', 'review_required', 'applying', 'applied', 'failed', 'abandoned')
    );

ALTER TABLE clinical_document_imports
    DROP CONSTRAINT IF EXISTS clinical_document_imports_abandon_check,
    ADD CONSTRAINT clinical_document_imports_abandon_check CHECK (
        status <> 'abandoned'
        OR (abandoned_at IS NOT NULL AND abandoned_by IS NOT NULL AND abandon_reason IS NOT NULL)
    );

-- A job processing right now has been claimed at least once.
UPDATE clinical_document_imports
SET attempts = 1
WHERE status = 'processing' AND attempts = 0;
