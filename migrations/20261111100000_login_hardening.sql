-- Sign-in hardening (security audit 2026-11-10).
--
-- 1. Wrong authenticator codes count per account: after the configured number
--    of mismatches the account is locked (`users.locked_until`), each further
--    lock lasting longer (`totp_lock_level`), until a sign-in completes.
-- 2. The wait for an administrator's approval is redeemed with a secret only
--    the signing-in client holds; the row id alone (which administrators see)
--    no longer yields the session. Only the SHA-256 of the secret is stored.
--    Rows created before this migration carry no hash and are refused: the
--    person signs in again.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS totp_failed_attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS totp_lock_level integer NOT NULL DEFAULT 0;

ALTER TABLE pending_logins
    ADD COLUMN IF NOT EXISTS poll_secret_hash text;
