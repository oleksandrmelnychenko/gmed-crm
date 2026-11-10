-- Security review 2026-11-10: the automatic link of a parent's existing
-- patient login to a minor's request goes by the trusted contact's e-mail.
-- A contact staff entered without an address could get its address from a
-- cabinet login, and the link then attached another person's login and
-- patient record. `cabinet_email` is the address a cabinet login wrote for
-- the contact (lower case); the automatic link skips a contact whose current
-- address equals it. NULL, or an address staff changed since, counts as
-- staff's.
--
-- No backfill: who wrote the address of an existing row is not known. Rows
-- of contacts the cabinet created (`contact_origin = 'portal'`) are never
-- linked automatically anyway; the others count as staff's, as before.
-- Adding a nullable column without a default does not rewrite the table.
ALTER TABLE lead_representatives
    ADD COLUMN IF NOT EXISTS cabinet_email TEXT;
