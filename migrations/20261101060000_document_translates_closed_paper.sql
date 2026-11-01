-- Whether a document is a translation of a paper closed to the interpreters:
-- directly or as a translation of such a translation, in any depth and in any
-- version of each. QA 2026-11-01: a translation repeats its source, so what
-- the translators' work does not open as a source it does not open as a
-- result either (documents::is_closed_to_interpreter_team reads this as
-- `translates_closed_paper`; a share or an assignment by name still opens it).
--
-- The walk is the one of document_translates_consent; the types are those of
-- documents::is_closed_to_interpreter_team.
CREATE OR REPLACE FUNCTION document_translates_closed_paper(target UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE links AS (
        SELECT document_id, translated_document_id
        FROM document_translations
        WHERE translated_document_id IS NOT NULL
        UNION ALL
        SELECT document_id, translated_document_id
        FROM document_translation_requests
        WHERE translated_document_id IS NOT NULL
    ), sources (document_id, depth) AS (
        SELECT link.document_id, 1
        FROM links link
        JOIN documents translated ON translated.id = link.translated_document_id
        WHERE COALESCE(translated.version_root_document_id, translated.id) = (
            SELECT COALESCE(target_document.version_root_document_id, target_document.id)
            FROM documents target_document
            WHERE target_document.id = target
        )
        UNION
        SELECT link.document_id, sources.depth + 1
        FROM sources
        JOIN documents source_document ON source_document.id = sources.document_id
        JOIN links link ON true
        JOIN documents translated ON translated.id = link.translated_document_id
        WHERE COALESCE(translated.version_root_document_id, translated.id)
              = COALESCE(source_document.version_root_document_id, source_document.id)
          AND sources.depth < 16
    )
    SELECT document_translates_consent(target) OR EXISTS (
        SELECT 1
        FROM sources
        JOIN documents closed_source ON closed_source.id = sources.document_id
        WHERE closed_source.category IN ('compliance_aml', 'identity', 'personal',
               'passport', 'passport_scan', 'personal_passport',
               'personal_residence_permit', 'personal_birth_certificate',
               'residence_permit', 'birth_certificate', 'id_card', 'identity_card')
           OR lower(COALESCE(closed_source.art, '')) IN (
               'identity', 'personal', 'passport', 'passport_scan', 'personal_passport',
               'personal_residence_permit', 'personal_birth_certificate',
               'residence_permit', 'birth_certificate', 'id_card', 'identity_card',
               'enhanced_due_diligence', 'gwg_identification', 'lead_self_disclosure',
               'payer_self_disclosure', 'patient_payer_statement', 'payer_cost_estimate',
               'self_funds_proof', 'relationship_proof', 'representative_identity',
               'representative_authority', 'payer_identity', 'payer_funds_proof')
           OR closed_source.generated_template_id IN (
               'enhanced_due_diligence', 'gwg_identification', 'lead_self_disclosure',
               'payer_self_disclosure', 'patient_payer_statement', 'payer_cost_estimate')
           OR closed_source.compliance_kind IN ('identity', 'enhanced_due_diligence')
    )
$$;
