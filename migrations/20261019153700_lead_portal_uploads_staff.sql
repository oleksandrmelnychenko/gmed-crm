-- Staff upload a representative's identity document or proof of authority
-- from the lead wizard (owner report 2026-10-19): the file is registered in
-- `lead_portal_uploads` like the cabinet's upload, so the contract gate and
-- the cabinet see it, with `access_kind = 'staff'` and the staff user as
-- uploader. No backfill: every existing row keeps its access kind.
ALTER TABLE lead_portal_uploads
    DROP CONSTRAINT IF EXISTS lead_portal_uploads_access_kind_check;
ALTER TABLE lead_portal_uploads
    ADD CONSTRAINT lead_portal_uploads_access_kind_check CHECK (
        access_kind IN ('self', 'guardian', 'payer', 'staff')
    );

-- A staff file is always a representative's file.
ALTER TABLE lead_portal_uploads
    DROP CONSTRAINT IF EXISTS lead_portal_uploads_staff_kind_check;
ALTER TABLE lead_portal_uploads
    ADD CONSTRAINT lead_portal_uploads_staff_kind_check CHECK (
        access_kind <> 'staff'
        OR kind IN ('representative_identity', 'representative_authority')
    );
