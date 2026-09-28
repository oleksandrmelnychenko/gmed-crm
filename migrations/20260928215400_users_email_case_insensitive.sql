-- Sign-in matches e-mail addresses case-insensitively (owner decision
-- 2026-09-28, Q12). A case-insensitive unique index keeps two accounts from
-- differing only in the case of their address; user administration refuses
-- such a collision with 409 before it reaches the index.
--
-- Should a database already hold such a pair, the index is created
-- non-unique instead (the login then prefers the exact spelling) and a
-- warning names the situation so the accounts can be merged by hand.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM users
        GROUP BY lower(btrim(email))
        HAVING count(*) > 1
    ) THEN
        RAISE WARNING 'users: e-mail addresses differing only in case exist; idx_users_email_lower is created non-unique';
        CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(btrim(email)));
    ELSE
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(btrim(email)));
    END IF;
END $$;
