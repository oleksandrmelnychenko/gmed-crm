-- Machine-translation drafts now come from the offline OPUS-MT service
-- ('local'); DeepL is no longer used. Existing 'deepl' rows stay valid as
-- history, but new rows can only be 'local' or 'manual' at the API level.
ALTER TABLE document_translations
    DROP CONSTRAINT IF EXISTS document_translations_provider_check;

ALTER TABLE document_translations
    ADD CONSTRAINT document_translations_provider_check
    CHECK (provider IN ('local', 'manual', 'deepl'));
