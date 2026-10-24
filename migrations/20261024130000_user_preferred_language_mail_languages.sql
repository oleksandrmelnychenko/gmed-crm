-- A person's own language (owner decision 2026-10-24): besides the RU/DE of
-- the staff console, the lead cabinet and the e-mails speak UA and EN, and a
-- parent's choice is kept on the account so the e-mails to that parent use
-- it. Existing values (ru, de) stay valid.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_preferred_language_check;
ALTER TABLE users
    ADD CONSTRAINT users_preferred_language_check
        CHECK (preferred_language IS NULL OR preferred_language IN ('de', 'ru', 'uk', 'en'));
