-- Structured onboarding data that must survive lead -> patient conversion.
ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS insurance_provider TEXT,
    ADD COLUMN IF NOT EXISTS insurance_number TEXT,
    ADD COLUMN IF NOT EXISTS insurance_type TEXT,
    ADD COLUMN IF NOT EXISTS trusted_contact_name TEXT,
    ADD COLUMN IF NOT EXISTS trusted_contact_phone TEXT,
    ADD COLUMN IF NOT EXISTS trusted_contact_relation TEXT,
    ADD COLUMN IF NOT EXISTS trusted_contact_birth_date DATE,
    ADD COLUMN IF NOT EXISTS trusted_contact_address TEXT;

ALTER TABLE leads
    DROP CONSTRAINT IF EXISTS leads_insurance_type_chk;

ALTER TABLE leads
    ADD CONSTRAINT leads_insurance_type_chk
    CHECK (
        insurance_type IS NULL
        OR insurance_type IN ('private', 'public', 'self_pay', 'foreign')
    );

ALTER TABLE patients
    ADD COLUMN IF NOT EXISTS intake_profile JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE patients
    DROP CONSTRAINT IF EXISTS patients_intake_profile_object_chk;

ALTER TABLE patients
    ADD CONSTRAINT patients_intake_profile_object_chk
    CHECK (jsonb_typeof(intake_profile) = 'object');

-- Every stored document gets a stable human-readable reference. Commercial
-- documents retain the authoritative FC/A/KV business number plus a version.
ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS document_number TEXT;

CREATE SEQUENCE IF NOT EXISTS document_number_seq START 1;

CREATE OR REPLACE FUNCTION assign_document_number()
RETURNS TRIGGER AS $$
DECLARE
    domain_number TEXT;
    document_version INTEGER;
    prefix TEXT;
    sequence_value BIGINT;
BEGIN
    IF NULLIF(btrim(NEW.document_number), '') IS NOT NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.generated_template_id = 'framework_contract' THEN
        SELECT fc.contract_number
          INTO domain_number
          FROM framework_contracts fc
         WHERE fc.id = (
             SELECT o.contract_id FROM orders o WHERE o.id = NEW.order_id
         );
    ELSIF NEW.generated_template_id = 'single_order' THEN
        SELECT o.order_number
          INTO domain_number
          FROM orders o
         WHERE o.id = NEW.order_id;
    ELSIF NEW.generated_template_id = 'cost_estimate' THEN
        SELECT q.quote_number
          INTO domain_number
          FROM quotes q
         WHERE q.order_id = NEW.order_id
         ORDER BY q.created_at DESC
         LIMIT 1;
    END IF;

    IF domain_number IS NOT NULL THEN
        -- Version allocation is serialized per business document number.
        PERFORM pg_advisory_xact_lock(hashtextextended(domain_number, 0));
        SELECT GREATEST(
                   COALESCE(MAX(substring(d.document_number FROM '-V([0-9]+)$')::integer), 0) + 1,
                   GREATEST(COALESCE(NEW.version_number, 1), 1)
               )
          INTO document_version
          FROM documents d
         WHERE d.document_number LIKE domain_number || '-V%';
        NEW.document_number := format(
            '%s-V%s',
            domain_number,
            lpad(document_version::text, 2, '0')
        );
        RETURN NEW;
    END IF;

    prefix := CASE COALESCE(NEW.generated_template_id, NEW.art, '')
        WHEN 'confidentiality_release' THEN 'SE'
        WHEN 'privacy_consents' THEN 'EW'
        WHEN 'consent_data_release_child' THEN 'EW'
        WHEN 'consent_data_release_single' THEN 'EW'
        WHEN 'identity' THEN 'ID'
        WHEN 'patient_sticker_compact' THEN 'ET'
        WHEN 'patient_sticker_standard' THEN 'ET'
        WHEN 'patient_sticker_sheet' THEN 'ET'
        ELSE 'DOC'
    END;
    sequence_value := nextval('document_number_seq');
    NEW.document_number := format(
        '%s-%s-%s',
        prefix,
        to_char(CURRENT_DATE, 'YYYYMMDD'),
        lpad(sequence_value::text, 6, '0')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_document_number ON documents;

CREATE TRIGGER set_document_number
    BEFORE INSERT ON documents
    FOR EACH ROW
    EXECUTE FUNCTION assign_document_number();

WITH numbered AS (
    SELECT id, row_number() OVER (ORDER BY created_at, id) AS row_no
      FROM documents
     WHERE document_number IS NULL OR btrim(document_number) = ''
)
UPDATE documents d
   SET document_number = format(
       'DOC-%s-%s',
       to_char(d.created_at, 'YYYYMMDD'),
       lpad(numbered.row_no::text, 6, '0')
   )
  FROM numbered
 WHERE numbered.id = d.id;

SELECT setval(
    'document_number_seq',
    GREATEST((SELECT count(*) FROM documents), 1),
    true
);

ALTER TABLE documents
    ALTER COLUMN document_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_document_number
    ON documents (document_number);
