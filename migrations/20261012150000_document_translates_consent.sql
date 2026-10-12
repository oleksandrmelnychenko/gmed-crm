-- Whether a document is a translation of a consent document — directly or as a
-- translation of such a translation, in any depth, and in any version of each.
-- Owner decision 2026-10-11: Concierge and Billing never open a consent
-- document (Schweigepflichtsentbindung, DSGVO consent and its variants, the
-- privacy information sheet); a translation repeats the consent's content, so
-- the same rule applies (documents::is_consent_document_row reads this as
-- `translates_consent_document`).
--
-- A translation is a document of its own linked through
-- `document_translations.translated_document_id` or
-- `document_translation_requests.translated_document_id` (the latest version;
-- older versions share its `version_root_document_id`). The walk starts from
-- the small link tables and reaches documents by primary key only.
CREATE OR REPLACE FUNCTION document_translates_consent(target UUID)
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
    SELECT EXISTS (
        SELECT 1
        FROM sources
        JOIN documents consent_source ON consent_source.id = sources.document_id
        WHERE consent_source.category = 'consent'
           OR consent_source.art IN ('confidentiality_release', 'privacy_consents',
               'privacy_information', 'consent_data_release', 'consent', 'consent_form',
               'gdpr_consent', 'einverstaendniserklaerung')
           OR consent_source.generated_template_id IN ('confidentiality_release',
               'privacy_consents', 'privacy_information', 'consent_data_release_child',
               'consent_data_release_single')
           OR consent_source.compliance_kind IN ('dsgvo', 'confidentiality_release')
    )
$$;
