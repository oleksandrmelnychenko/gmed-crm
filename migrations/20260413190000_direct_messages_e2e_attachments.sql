ALTER TABLE direct_messages
    ADD COLUMN IF NOT EXISTS attachment_e2e_algorithm TEXT
        CHECK (
            attachment_e2e_algorithm IS NULL
            OR attachment_e2e_algorithm IN ('p256-hkdf-aes256gcm-v1')
        ),
    ADD COLUMN IF NOT EXISTS attachment_e2e_nonce BYTEA,
    ADD COLUMN IF NOT EXISTS attachment_e2e_salt BYTEA;
