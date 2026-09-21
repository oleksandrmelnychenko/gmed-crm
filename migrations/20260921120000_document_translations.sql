-- Document translations kept as children of the source document.
-- A row stores the reviewed translation text; the generated translated
-- document (a separate `documents` row) is linked through
-- `translated_document_id`, so one document can carry a tree of translations
-- into several languages without touching the original file.
CREATE TABLE IF NOT EXISTS document_translations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    source_language TEXT,
    target_language TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('deepl', 'manual')),
    source_text TEXT,
    translated_text TEXT NOT NULL,
    characters INTEGER NOT NULL DEFAULT 0,
    translated_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_translations_document
    ON document_translations(document_id, created_at DESC);
