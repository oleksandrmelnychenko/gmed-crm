-- The SHA-256 of an upload's content (owner 2026-10-24): the same file in the
-- same slot of the same request is not stored again. Older rows have none and
-- are not compared.
ALTER TABLE lead_portal_uploads
    ADD COLUMN IF NOT EXISTS content_sha256 TEXT;

CREATE INDEX IF NOT EXISTS idx_lead_portal_uploads_content
    ON lead_portal_uploads (lead_id, kind, content_sha256)
    WHERE content_sha256 IS NOT NULL AND withdrawn_at IS NULL;
