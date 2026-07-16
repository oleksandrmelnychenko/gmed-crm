-- A lead can authorize any number of trusted contacts / additional data recipients.
-- Keep the legacy scalar columns as a first-contact compatibility projection.
ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS trusted_contacts JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE leads
    DROP CONSTRAINT IF EXISTS leads_trusted_contacts_array_chk;

ALTER TABLE leads
    ADD CONSTRAINT leads_trusted_contacts_array_chk
    CHECK (jsonb_typeof(trusted_contacts) = 'array');

UPDATE leads
   SET trusted_contacts = jsonb_build_array(
       jsonb_build_object(
           'id', gen_random_uuid(),
           'name', btrim(trusted_contact_name),
           'email', NULLIF(btrim(trusted_contact_email), ''),
           'phone', NULLIF(btrim(trusted_contact_phone), ''),
           'relation', NULLIF(btrim(trusted_contact_relation), ''),
           'birth_date', trusted_contact_birth_date,
           'address', NULLIF(btrim(trusted_contact_address), '')
       )
   )
 WHERE trusted_contacts = '[]'::jsonb
   AND NULLIF(btrim(trusted_contact_name), '') IS NOT NULL;
