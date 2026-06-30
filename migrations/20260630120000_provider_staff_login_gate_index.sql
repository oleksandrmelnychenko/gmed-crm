-- External contractors / unspecified-status provider staff (Внешний / не указано)
-- must not hold a usable login account. Login, user creation and the Users & Roles
-- listing match a `users.email` against provider staff emails. Index the normalized
-- email so that per-login lookup stays fast.
CREATE INDEX IF NOT EXISTS idx_provider_person_contacts_email_lower
    ON provider_person_contacts (lower(btrim(value)))
    WHERE contact_kind = 'email';
