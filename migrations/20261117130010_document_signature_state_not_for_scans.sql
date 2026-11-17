-- QA verify2 C S3-6: an identity scan or an enhanced-due-diligence proof is
-- marked "signed" when staff confirm it (documents.signed_at), but it is
-- evidence, not a document made to be signed: the lists show no signature
-- chip for it. Real signed documents (generated or uploaded consents,
-- contracts, declarations) keep `signed`.

CREATE OR REPLACE FUNCTION document_signature_state(target UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN COALESCE(d.compliance_kind, '') IN ('identity', 'enhanced_due_diligence')
             OR COALESCE(d.art, '') = 'identity' THEN NULL
        WHEN d.signed_at IS NOT NULL THEN 'signed'
        WHEN NOT document_template_requires_signature(d.generated_template_id) THEN NULL
        WHEN document_signature_sent_at(d.id) IS NOT NULL THEN 'sent'
        WHEN d.status = 'archived' OR d.file_deleted_at IS NOT NULL THEN NULL
        WHEN EXISTS (SELECT 1 FROM documents newer WHERE newer.replaces_document_id = d.id) THEN NULL
        ELSE 'not_sent'
    END
    FROM documents d
    WHERE d.id = target
$$;
