ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS generated_template_id TEXT;

UPDATE documents
SET generated_template_id = substring(ursprung FROM '^template:(.+)$')
WHERE generated_template_id IS NULL
  AND ursprung ~ '^template:.+$';

UPDATE documents
SET generated_template_id = ursprung
WHERE generated_template_id IS NULL
  AND ursprung ~ '^provider_template:[0-9a-fA-F-]{36}$';

UPDATE documents
SET category = 'contract'
WHERE generated_template_id = 'framework_contract'
  AND category = 'generated';

UPDATE documents
SET category = 'administrative'
WHERE generated_template_id IN (
        'patient_sticker_compact',
        'patient_sticker_standard',
        'patient_sticker_sheet'
    )
  AND category = 'generated';

CREATE INDEX IF NOT EXISTS idx_documents_generated_template_id
    ON documents(generated_template_id)
    WHERE generated_template_id IS NOT NULL;
