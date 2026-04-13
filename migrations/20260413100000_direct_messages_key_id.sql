-- Track which encryption key sealed each row so we can rotate without downtime.
--
-- Workflow:
--   1. Operator adds a new key with a fresh id to MESSAGE_ENCRYPTION_KEYS,
--      sets MESSAGE_ENCRYPTION_KEY_ACTIVE to the new id, restarts.
--   2. New writes are sealed with the active key; old rows still readable
--      because the old key remains in the registry.
--   3. Admin runs `POST /admin/security/rewrap-messages` (or background sweep)
--      which re-encrypts all rows under the active key.
--   4. Once `key_id_distribution` reports 100% on the active id, the old
--      key can be removed from MESSAGE_ENCRYPTION_KEYS.
--
-- Existing rows encrypted before this migration get a default `legacy` id;
-- the registry maps that id to whatever value was previously sourced from
-- the bare MESSAGE_ENCRYPTION_KEY env var.

ALTER TABLE direct_messages
    ADD COLUMN IF NOT EXISTS encryption_key_id TEXT;

UPDATE direct_messages
   SET encryption_key_id = 'legacy'
 WHERE encryption_key_id IS NULL
   AND (message_ciphertext IS NOT NULL OR attachment_nonce IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_direct_messages_key_id
    ON direct_messages (encryption_key_id)
    WHERE encryption_key_id IS NOT NULL;
