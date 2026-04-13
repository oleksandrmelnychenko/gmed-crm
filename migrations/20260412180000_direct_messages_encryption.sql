-- AES-256-GCM encryption for direct_messages.
--
-- Strategy:
--   1. Add `message_ciphertext` (BYTEA) and `message_nonce` (BYTEA, 12 bytes).
--   2. `message` column becomes nullable during the transition.
--   3. Existing plaintext rows keep their value in `message` until a one-time
--      re-encryption pass runs on startup (handled in code).
--   4. A follow-up migration will DROP the `message` column once backfill
--      completes and tests pass.
--
-- Note: we deliberately do NOT move the ciphertext to pgcrypto — the key must
-- stay in the application process so that a DB dump alone cannot decrypt.

ALTER TABLE direct_messages
    ADD COLUMN IF NOT EXISTS message_ciphertext BYTEA,
    ADD COLUMN IF NOT EXISTS message_nonce BYTEA;

ALTER TABLE direct_messages
    ALTER COLUMN message DROP NOT NULL;

-- Attachment payload is still written to disk; we encrypt the filename (which
-- may contain patient PII) and mime hints just for consistency. The file body
-- itself is encrypted in `uploads/chat/` by the application layer.
ALTER TABLE direct_messages
    ADD COLUMN IF NOT EXISTS attachment_nonce BYTEA;

-- Index unchanged: conversation lookup is on (from_user, to_user, created_at),
-- not on message text. No full-text search supported on encrypted content by
-- design.
