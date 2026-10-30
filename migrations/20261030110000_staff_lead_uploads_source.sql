-- Files staff upload for a lead (in the client's form or a representative's
-- file in the wizard) name GMED staff as their source (owner 2026-10-30): the
-- patient card said «Портал пациента» for files staff uploaded in the client's
-- form. The files staff uploaded before are corrected the same way.
UPDATE documents d
   SET ursprung = 'gmed_staff',
       source_person = 'gmed_staff'
  FROM lead_portal_uploads u
 WHERE u.document_id = d.id
   AND u.access_kind = 'staff'
   AND (d.source_person IS NULL OR d.source_person = 'patient_portal')
   AND (d.ursprung IS NULL OR d.ursprung = 'lead_portal');

-- Staff record the client's consent that GMED contacts the payer with how the
-- client gave it, like the cost-estimate consent (owner 2026-10-30).
ALTER TABLE lead_payer_declarations ADD COLUMN IF NOT EXISTS contact_consent_recorded_how TEXT;
ALTER TABLE lead_payer_declarations ADD COLUMN IF NOT EXISTS contact_consent_recorded_note TEXT;
