-- QA E-19 (2026-10-11): five wrong passwords from anywhere locked any account,
-- the CEO's included, and the lock answered differently from an unknown
-- e-mail. Failed sign-ins are now throttled per account and client address:
-- after `max_failed_login_attempts` failures that pair waits
-- `lockout_duration_minutes`, doubling with every further lock (at most a
-- day); other addresses keep signing in. The account-wide lock
-- (`users.locked_until`) stays as a temporary safety net against distributed
-- guessing and expires on its own. Both keys are pseudonymous: the SHA-256 of
-- the normalised e-mail address (also for unknown addresses) and the salted
-- IP hash of the audit log.
CREATE TABLE IF NOT EXISTS login_attempt_throttle (
    subject_hash TEXT NOT NULL,
    ip_hash TEXT NOT NULL DEFAULT '',
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    lock_level INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (subject_hash, ip_hash)
);

CREATE INDEX IF NOT EXISTS idx_login_attempt_throttle_last_failed
    ON login_attempt_throttle (last_failed_at);
