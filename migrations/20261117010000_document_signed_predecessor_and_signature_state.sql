-- fix-98 (owner 2026-11-16).
--
-- 1. While a new version of a consent document waits for its signature, the
--    previous SIGNED version of the same chain stays in force (removals of a
--    consent change already apply, additions wait for the signature). The
--    required-document check and the legal-status evidence count that signed
--    version. Only the consent family (Einverständniserklärung and its child
--    variants, Schweigepflichtsentbindung): a contract or an estimate whose
--    new version is due because its terms changed never falls back to the
--    old signed one.
CREATE OR REPLACE FUNCTION document_is_consent_family(
    template_id TEXT, art TEXT, compliance_kind TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT COALESCE(template_id, '') IN (
               'privacy_consents', 'consent_data_release_child',
               'consent_data_release_single', 'confidentiality_release')
        OR COALESCE(art, '') IN (
               'dsgvo', 'privacy_consents', 'consent_data_release',
               'consent_data_release_child', 'consent_data_release_single', 'consent_form',
               'einverstaendniserklaerung', 'gdpr_consent', 'consent', 'confidentiality_release')
        OR COALESCE(compliance_kind, '') IN ('dsgvo', 'confidentiality_release')
$$;

CREATE OR REPLACE FUNCTION document_signed_predecessor_in_force(target UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE((
        SELECT d.signed_at IS NOT NULL
           AND d.file_deleted_at IS NULL
           AND document_is_consent_family(d.generated_template_id, d.art, d.compliance_kind)
           -- Superseded by a later version ...
           AND EXISTS (SELECT 1 FROM documents newer WHERE newer.replaces_document_id = d.id)
           -- ... none of which is signed ...
           AND NOT EXISTS (
               SELECT 1 FROM documents later
               WHERE later.version_root_document_id = d.version_root_document_id
                 AND later.version_number > d.version_number
                 AND later.signed_at IS NOT NULL)
           -- ... and whose current version is still a live draft (an archived
           -- or deleted chain proves nothing).
           AND EXISTS (
               SELECT 1 FROM documents head
               WHERE head.version_root_document_id = d.version_root_document_id
                 AND head.version_number > d.version_number
                 AND head.status <> 'archived'
                 AND head.file_deleted_at IS NULL
                 AND NOT EXISTS (
                     SELECT 1 FROM documents newer WHERE newer.replaces_document_id = head.id))
        FROM documents d
        WHERE d.id = target
    ), false)
$$;

-- 2. Signature state of a document version for the document lists: the
--    newest signature request that is still running (a withdrawn, declined,
--    expired or failed one does not count: fix-87 withdraws the invitations
--    on every consent change), the document itself or as a package member.
CREATE OR REPLACE FUNCTION document_signature_sent_at(target UUID)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
AS $$
    SELECT max(request.created_at)
    FROM document_signature_requests request
    WHERE request.status IN ('submitting', 'submission_unknown', 'pending')
      AND (request.source_document_id = target
           OR EXISTS (SELECT 1 FROM document_signature_members member
                      WHERE member.request_id = request.id
                        AND member.document_id = target))
$$;

-- The generated documents that are made to be signed: the consent forms and
-- the order / contract documents of `document_manual_version_locked`.
CREATE OR REPLACE FUNCTION document_template_requires_signature(template_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT COALESCE(template_id, '') IN (
        'privacy_consents', 'consent_data_release_child', 'consent_data_release_single',
        'confidentiality_release',
        'framework_contract', 'single_order', 'order_cost_estimate', 'cost_estimate',
        'cost_coverage_declaration', 'payer_cost_estimate', 'patient_payer_statement')
$$;

-- `signed` (signed_at), `sent` (a running signature request), `not_sent` (a
-- current, unsigned version of a document made to be signed) or NULL.
CREATE OR REPLACE FUNCTION document_signature_state(target UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
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
