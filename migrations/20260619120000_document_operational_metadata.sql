ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS document_direction TEXT CHECK (
        document_direction IS NULL OR document_direction IN ('incoming', 'outgoing')
    ),
    ADD COLUMN IF NOT EXISTS document_variant TEXT CHECK (
        document_variant IS NULL OR document_variant IN ('original', 'translation')
    ),
    ADD COLUMN IF NOT EXISTS document_language TEXT,
    ADD COLUMN IF NOT EXISTS access_category TEXT CHECK (
        access_category IS NULL OR access_category IN (
            'internal',
            'patient',
            'provider',
            'authority',
            'financial',
            'medical',
            'other'
        )
    ),
    ADD COLUMN IF NOT EXISTS document_date DATE,
    ADD COLUMN IF NOT EXISTS source_person TEXT,
    ADD COLUMN IF NOT EXISTS source_institution TEXT,
    ADD COLUMN IF NOT EXISTS addressee_person TEXT,
    ADD COLUMN IF NOT EXISTS addressee_institution TEXT,
    ADD COLUMN IF NOT EXISTS financial_status TEXT CHECK (
        financial_status IS NULL OR financial_status IN (
            'open',
            'in_progress',
            'paid',
            'overdue',
            'billed_to_patient',
            'reimbursed'
        )
    ),
    ADD COLUMN IF NOT EXISTS payment_due_date DATE,
    ADD COLUMN IF NOT EXISTS payment_date DATE,
    ADD COLUMN IF NOT EXISTS payment_method TEXT CHECK (
        payment_method IS NULL OR payment_method IN (
            'cash',
            'bank_transfer',
            'card',
            'other'
        )
    );

UPDATE documents
SET document_direction = COALESCE(
        document_direction,
        CASE
            WHEN generated_template_id IS NOT NULL
              OR COALESCE(ursprung, '') LIKE 'template:%'
              OR COALESCE(category, '') = 'generated'
              THEN 'outgoing'
            ELSE 'incoming'
        END
    ),
    document_variant = COALESCE(
        document_variant,
        CASE
            WHEN COALESCE(category, '') = 'translation'
              OR COALESCE(art, '') IN ('translation', 'translated_document')
              OR COALESCE(ursprung, '') = 'translation_request'
              THEN 'translation'
            ELSE 'original'
        END
    ),
    access_category = COALESCE(
        access_category,
        CASE
            WHEN is_medical THEN 'medical'
            WHEN COALESCE(category, '') IN ('finance', 'financial', 'invoice')
              OR COALESCE(art, '') ILIKE ANY (ARRAY['%invoice%', '%rechnung%', '%kosten%', '%payment%'])
              THEN 'financial'
            WHEN visibility = 'patient_visible' THEN 'patient'
            WHEN COALESCE(category, '') IN ('official', 'agency') THEN 'authority'
            ELSE 'internal'
        END
    ),
    document_date = COALESCE(document_date, created_at::date),
    source_institution = COALESCE(source_institution, NULLIF(klinik, '')),
    source_person = COALESCE(source_person, NULLIF(ursprung, ''));

CREATE INDEX IF NOT EXISTS idx_doc_direction_patient
    ON documents(document_direction, patient_id);

CREATE INDEX IF NOT EXISTS idx_doc_financial_status_due
    ON documents(financial_status, payment_due_date)
    WHERE financial_status IS NOT NULL;
