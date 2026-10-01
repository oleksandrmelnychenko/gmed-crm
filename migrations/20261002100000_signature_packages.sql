-- Electronic signature packages (owner decisions 2026-10-01).
--
-- * A request may carry several documents of one patient or one lead. Skribble
--   signs one merged PDF; the signed result is stored once as a canonical
--   bundle document. Members keep their own rows and point to the bundle with
--   the page range that holds them; nothing is split or copied, because any
--   extract would no longer carry the qualified signature.
-- * Signature level: QES by default; consents and cost estimates may be sent
--   as AES. A package uses the highest minimum level of its members
--   (§ 126a BGB: written form requires a QES).
-- * Expiry, a short invitation note and the invitation language are stored
--   with the request and sent to the provider.
-- * Several informational attachments per request (Datenschutzinformation and
--   Kostenkalkulation can both belong to one package).
-- * The signed bundle, its report and the hashes are immutable once stored.

ALTER TABLE document_signature_requests
    ADD COLUMN IF NOT EXISTS level TEXT NOT NULL DEFAULT 'QES',
    ADD COLUMN IF NOT EXISTS minimum_level TEXT NOT NULL DEFAULT 'QES',
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS invitation_note TEXT,
    ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'de',
    ADD COLUMN IF NOT EXISTS is_package BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS source_page_count INTEGER,
    ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS effects_applied_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS delivered_to_signers_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS delivered_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS delivery_channel TEXT,
    ADD COLUMN IF NOT EXISTS provider_deleted_at TIMESTAMPTZ;

ALTER TABLE document_signature_requests
    DROP CONSTRAINT IF EXISTS document_signature_requests_level_check,
    DROP CONSTRAINT IF EXISTS document_signature_requests_minimum_level_check,
    DROP CONSTRAINT IF EXISTS document_signature_requests_level_minimum_check,
    DROP CONSTRAINT IF EXISTS document_signature_requests_language_check,
    DROP CONSTRAINT IF EXISTS document_signature_requests_invitation_note_check,
    DROP CONSTRAINT IF EXISTS document_signature_requests_source_page_count_check,
    DROP CONSTRAINT IF EXISTS document_signature_requests_delivery_channel_check;
ALTER TABLE document_signature_requests
    ADD CONSTRAINT document_signature_requests_level_check
        CHECK (level IN ('AES', 'QES')),
    ADD CONSTRAINT document_signature_requests_minimum_level_check
        CHECK (minimum_level IN ('AES', 'QES')),
    -- The applied level never falls below the minimum of the documents.
    ADD CONSTRAINT document_signature_requests_level_minimum_check
        CHECK (NOT (level = 'AES' AND minimum_level = 'QES')),
    ADD CONSTRAINT document_signature_requests_language_check
        CHECK (language IN ('de', 'en', 'fr', 'it')),
    ADD CONSTRAINT document_signature_requests_invitation_note_check
        CHECK (invitation_note IS NULL OR char_length(invitation_note) <= 500),
    ADD CONSTRAINT document_signature_requests_source_page_count_check
        CHECK (source_page_count IS NULL OR source_page_count > 0),
    ADD CONSTRAINT document_signature_requests_delivery_channel_check
        CHECK (delivery_channel IS NULL OR delivery_channel IN ('skribble', 'email', 'portal', 'in_person', 'post'));

COMMENT ON COLUMN document_signature_requests.level IS
    'Signature level requested and verified at the provider: QES (default) or AES (consents and cost estimates only).';
COMMENT ON COLUMN document_signature_requests.is_package IS
    'The request signs several documents as one merged PDF; result_document_id is the canonical signed bundle.';
COMMENT ON COLUMN document_signature_requests.delivered_to_signers_at IS
    'When staff recorded that the signers received the signed copy on a durable medium (§ 312f Abs. 2 BGB).';
COMMENT ON COLUMN document_signature_requests.provider_deleted_at IS
    'When the request was deleted at the provider after archiving (retention job, off by default).';

ALTER TABLE document_signature_members
    ADD COLUMN IF NOT EXISTS page_start INTEGER,
    ADD COLUMN IF NOT EXISTS page_count INTEGER;
ALTER TABLE document_signature_members
    DROP CONSTRAINT IF EXISTS document_signature_members_page_range_check;
ALTER TABLE document_signature_members
    ADD CONSTRAINT document_signature_members_page_range_check
        CHECK ((page_start IS NULL AND page_count IS NULL)
            OR (page_start > 0 AND page_count > 0));

-- Several informational attachments per request.
ALTER TABLE document_signature_attachments
    ADD COLUMN IF NOT EXISTS position SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE document_signature_attachments
    DROP CONSTRAINT IF EXISTS document_signature_attachments_position_check;
ALTER TABLE document_signature_attachments
    ADD CONSTRAINT document_signature_attachments_position_check CHECK (position > 0);
ALTER TABLE document_signature_attachments
    DROP CONSTRAINT IF EXISTS document_signature_attachments_pkey;
ALTER TABLE document_signature_attachments
    ADD CONSTRAINT document_signature_attachments_pkey PRIMARY KEY (request_id, document_id);
CREATE UNIQUE INDEX IF NOT EXISTS document_signature_attachments_position
    ON document_signature_attachments(request_id, position);

-- The poller also claims unconfirmed submissions; the old index left them out.
DROP INDEX IF EXISTS document_signature_poll;
CREATE INDEX document_signature_poll ON document_signature_requests(next_poll_at)
    WHERE status IN ('pending', 'submitting', 'submission_unknown');

CREATE INDEX IF NOT EXISTS document_signature_members_result
    ON document_signature_members(result_document_id)
    WHERE result_document_id IS NOT NULL;

-- The signed PDF is the legal original. Its bytes, storage key and hash may
-- never change and the row may not be deleted. Metadata (classification,
-- subject transfer on lead conversion, review promotion) stays editable.
-- Test (DEMO) evidence has no legal value and stays erasable.
CREATE OR REPLACE FUNCTION protect_signed_signature_documents()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.ursprung IN ('electronic_signature', 'electronic_signature_package')
       AND NOT EXISTS (
           SELECT 1 FROM document_signature_requests r
           WHERE r.result_document_id = OLD.id AND r.test_mode
       )
       -- Before this migration every member of a package got its own signed
       -- copy, linked only through its member row.
       AND NOT EXISTS (
           SELECT 1 FROM document_signature_members m
           JOIN document_signature_requests r ON r.id = m.request_id
           WHERE m.result_document_id = OLD.id AND r.test_mode
       ) THEN
        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'Signed signature documents cannot be deleted'
                USING ERRCODE = 'P0001';
        END IF;
        IF NEW.storage_key IS DISTINCT FROM OLD.storage_key
            OR NEW.file_size IS DISTINCT FROM OLD.file_size
            OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
            OR NEW.ursprung IS DISTINCT FROM OLD.ursprung
            OR (OLD.file_deleted_at IS NULL AND NEW.file_deleted_at IS NOT NULL) THEN
            RAISE EXCEPTION 'Signed signature documents are immutable'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_signed_signature_documents ON documents;
CREATE TRIGGER protect_signed_signature_documents
    BEFORE UPDATE OR DELETE ON documents
    FOR EACH ROW
    EXECUTE FUNCTION protect_signed_signature_documents();

-- Once archived, the result, the report and the hashes of a request are fixed,
-- and an archived request is never deleted.
CREATE OR REPLACE FUNCTION protect_archived_signature_requests()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.report_storage_key IS NOT NULL THEN
        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'Archived signature requests cannot be deleted'
                USING ERRCODE = 'P0001';
        END IF;
        IF NEW.report_storage_key IS DISTINCT FROM OLD.report_storage_key
            OR NEW.report_sha256 IS DISTINCT FROM OLD.report_sha256
            OR NEW.signed_sha256 IS DISTINCT FROM OLD.signed_sha256
            OR NEW.result_document_id IS DISTINCT FROM OLD.result_document_id
            OR NEW.source_sha256 IS DISTINCT FROM OLD.source_sha256
            OR NEW.level IS DISTINCT FROM OLD.level THEN
            RAISE EXCEPTION 'Archived signature evidence is immutable'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_archived_signature_requests ON document_signature_requests;
CREATE TRIGGER protect_archived_signature_requests
    BEFORE UPDATE OR DELETE ON document_signature_requests
    FOR EACH ROW
    EXECUTE FUNCTION protect_archived_signature_requests();

-- Deleting archived requests at the provider (GDPR data minimisation) stays
-- off until the provider endpoint has been verified on the demo account.
INSERT INTO system_settings (key, value, description)
VALUES
    ('signature_provider_deletion_enabled', 'false',
     'Delete archived signature requests at the signature provider after the retention days (off until the provider endpoint is verified)'),
    ('signature_provider_deletion_days', '30',
     'Days after archiving before a signature request is deleted at the signature provider')
ON CONFLICT (key) DO NOTHING;
