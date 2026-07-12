ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS generated_bindings JSONB,
    ADD COLUMN IF NOT EXISTS generated_manual_text TEXT;

ALTER TABLE documents
    DROP CONSTRAINT IF EXISTS documents_generated_bindings_object;

ALTER TABLE documents
    ADD CONSTRAINT documents_generated_bindings_object
    CHECK (generated_bindings IS NULL OR jsonb_typeof(generated_bindings) = 'object');

COMMENT ON COLUMN documents.generated_bindings IS
    'Operator-supplied binding overrides used for generated document version round-trips.';

COMMENT ON COLUMN documents.generated_manual_text IS
    'Exact operator-edited manual PDF text; NULL means the structured template renderer was used.';
