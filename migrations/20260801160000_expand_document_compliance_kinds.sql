ALTER TABLE documents
    DROP CONSTRAINT IF EXISTS documents_compliance_kind_check;

ALTER TABLE documents
    ADD CONSTRAINT documents_compliance_kind_check
    CHECK (
        compliance_kind IS NULL
        OR compliance_kind IN (
            'dsgvo',
            'confidentiality_release',
            'identity',
            'framework_contract',
            'enhanced_due_diligence',
            'other'
        )
    );
