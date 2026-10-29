-- Staff fill in the client's own form (owner decision 2026-10-29): they upload
-- the identity scan, documents and proofs for the client, not only a
-- representative's files from the wizard. The upload stays marked
-- `access_kind = 'staff'` with the staff user as uploader; the 2026-10-19 rule
-- that a staff file is always a representative's file is dropped.
ALTER TABLE lead_portal_uploads
    DROP CONSTRAINT IF EXISTS lead_portal_uploads_staff_kind_check;
