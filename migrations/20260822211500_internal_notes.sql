CREATE TABLE IF NOT EXISTS internal_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    body TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    updated_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ,
    CONSTRAINT internal_notes_title_check
        CHECK (NULLIF(BTRIM(title), '') IS NOT NULL AND char_length(title) <= 255),
    CONSTRAINT internal_notes_body_check
        CHECK (body IS NULL OR char_length(body) <= 20000)
);

CREATE TABLE IF NOT EXISTS internal_note_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id UUID NOT NULL REFERENCES internal_notes(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    file_nonce BYTEA NOT NULL,
    encryption_key_id TEXT NOT NULL,
    uploaded_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT internal_note_attachments_file_name_check
        CHECK (NULLIF(BTRIM(file_name), '') IS NOT NULL AND char_length(file_name) <= 255),
    CONSTRAINT internal_note_attachments_file_size_check
        CHECK (file_size > 0 AND file_size <= 20971520)
);

CREATE INDEX IF NOT EXISTS idx_internal_notes_updated_at
    ON internal_notes (updated_at DESC)
    WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_internal_note_attachments_note
    ON internal_note_attachments (note_id, created_at);
