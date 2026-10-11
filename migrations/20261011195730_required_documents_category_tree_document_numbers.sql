-- QA 2026-10-11 (B-06, B-11, B-12, B-18, B-07, B-19):
-- 1. the minimum patient document pack counts only real documents;
-- 2. every legacy document category sits under its parent in the tree;
-- 3. one readable document number format, also for generated documents and
--    for the next versions of a document.
-- Existing document numbers are never changed.

-- 1. Required patient documents (`system_settings.required_patient_documents`).
--    Passport: also the passport category of the category tree
--    (`personal_passport`) and the identity document of a converted lead
--    (`identity`). Consent form: only the DSGVO consent family
--    (Einverständniserklärung zur Datenübermittlung and its variants for
--    children), and only once it is signed; the category matchers
--    `administrative` and `consent` go, because they also hold patient
--    stickers, the Schweigepflichtsentbindung and the privacy information
--    sheet. Rules an administrator added are kept unchanged.
UPDATE system_settings
SET value = (
        SELECT COALESCE(jsonb_agg(
                   CASE rules.rule->>'key'
                       WHEN 'passport' THEN rules.rule || jsonb_build_object(
                           'art', (
                               SELECT jsonb_agg(DISTINCT matcher)
                               FROM (
                                   SELECT jsonb_array_elements_text(
                                              CASE WHEN jsonb_typeof(rules.rule->'art') = 'array'
                                                   THEN rules.rule->'art' ELSE '[]'::jsonb END
                                          ) AS matcher
                                   UNION
                                   SELECT unnest(ARRAY[
                                       'passport', 'passport_scan', 'reisepass',
                                       'personal_passport', 'identity'
                                   ])
                               ) AS arts
                           ),
                           'category', (
                               SELECT jsonb_agg(DISTINCT matcher)
                               FROM (
                                   SELECT jsonb_array_elements_text(
                                              CASE WHEN jsonb_typeof(rules.rule->'category') = 'array'
                                                   THEN rules.rule->'category' ELSE '[]'::jsonb END
                                          ) AS matcher
                                   UNION
                                   SELECT unnest(ARRAY['identity', 'passport', 'personal_passport'])
                               ) AS categories
                           )
                       )
                       WHEN 'consent_form' THEN rules.rule || jsonb_build_object(
                           'art', (
                               SELECT jsonb_agg(DISTINCT matcher)
                               FROM (
                                   SELECT jsonb_array_elements_text(
                                              CASE WHEN jsonb_typeof(rules.rule->'art') = 'array'
                                                   THEN rules.rule->'art' ELSE '[]'::jsonb END
                                          ) AS matcher
                                   UNION
                                   SELECT unnest(ARRAY[
                                       'consent', 'consent_form', 'einverstaendniserklaerung',
                                       'gdpr_consent', 'privacy_consents', 'consent_data_release',
                                       'consent_data_release_child', 'consent_data_release_single'
                                   ])
                               ) AS arts
                           ),
                           'category', COALESCE((
                               SELECT jsonb_agg(matcher)
                               FROM jsonb_array_elements_text(
                                        CASE WHEN jsonb_typeof(rules.rule->'category') = 'array'
                                             THEN rules.rule->'category' ELSE '[]'::jsonb END
                                    ) AS matcher
                               WHERE matcher NOT IN ('administrative', 'consent')
                           ), '[]'::jsonb),
                           'signed', true
                       )
                       ELSE rules.rule
                   END
                   ORDER BY rules.position
               ), '[]'::jsonb)
        FROM jsonb_array_elements(system_settings.value) WITH ORDINALITY AS rules(rule, position)
    ),
    updated_at = now()
WHERE key = 'required_patient_documents'
  AND jsonb_typeof(value) = 'array';

-- 2. Category tree: three categories of the first taxonomy never got a parent
--    and appeared under whichever category preceded them by sort order.
UPDATE ref_document_categories
SET parent_id = 'medical',
    short_code = COALESCE(short_code, 'LAB'),
    access_category = COALESCE(access_category, 'medical')
WHERE id = 'lab_analysis'
  AND parent_id IS NULL;

UPDATE ref_document_categories
SET parent_id = 'medical',
    short_code = COALESCE(short_code, 'MED'),
    access_category = COALESCE(access_category, 'medical')
WHERE id IN ('medical_report', 'conclusion')
  AND parent_id IS NULL;

-- 3. Document numbers: `<prefix>-<YYYYMMDD>-<NNNNNN>` from one sequence for
--    every new document (uploads and generated documents alike); the next
--    version of a document keeps the number of the document with a version
--    suffix (`SE-20261011-000068-V02`), as contracts and orders already do.

-- The number prefix of a document type or generated template.
CREATE OR REPLACE FUNCTION document_number_prefix(number_kind TEXT)
RETURNS TEXT AS $$
    SELECT CASE lower(btrim(COALESCE(number_kind, '')))
        WHEN 'confidentiality_release' THEN 'SE'
        WHEN 'privacy_consents' THEN 'EW'
        WHEN 'consent_data_release' THEN 'EW'
        WHEN 'consent_data_release_child' THEN 'EW'
        WHEN 'consent_data_release_single' THEN 'EW'
        WHEN 'privacy_information' THEN 'DS'
        WHEN 'identity' THEN 'ID'
        WHEN 'patient_sticker' THEN 'ET'
        WHEN 'patient_sticker_compact' THEN 'ET'
        WHEN 'patient_sticker_standard' THEN 'ET'
        WHEN 'patient_sticker_sheet' THEN 'ET'
        WHEN 'enhanced_due_diligence' THEN 'AML'
        WHEN 'gwg_identification' THEN 'GWG'
        ELSE 'DOC'
    END
$$ LANGUAGE sql IMMUTABLE;

-- The next sequential number of a new document (today in the session's time
-- zone, Europe/Berlin).
CREATE OR REPLACE FUNCTION next_document_number(number_kind TEXT)
RETURNS TEXT AS $$
    SELECT format(
        '%s-%s-%s',
        document_number_prefix(number_kind),
        to_char(CURRENT_DATE, 'YYYYMMDD'),
        lpad(nextval('document_number_seq')::text, 6, '0')
    )
$$ LANGUAGE sql VOLATILE;

-- The number of the next version of a document: the number of the version it
-- replaces without its version suffix, plus `-V<NN>`. NULL when the replaced
-- document has no number.
CREATE OR REPLACE FUNCTION document_version_number(
    replaced_document_id UUID,
    new_version INTEGER
)
RETURNS TEXT AS $$
DECLARE
    base_number TEXT;
    next_version INTEGER;
BEGIN
    SELECT regexp_replace(btrim(d.document_number), '-V[0-9]+$', '')
      INTO base_number
      FROM documents d
     WHERE d.id = replaced_document_id;
    IF NULLIF(base_number, '') IS NULL THEN
        RETURN NULL;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(base_number, 0));
    SELECT GREATEST(
               COALESCE(MAX(substring(d.document_number FROM '-V([0-9]+)$')::integer), 1) + 1,
               COALESCE(new_version, 2),
               2
           )
      INTO next_version
      FROM documents d
     WHERE left(d.document_number, length(base_number) + 2) = base_number || '-V';
    RETURN format('%s-V%s', base_number, lpad(next_version::text, 2, '0'));
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION assign_document_number()
RETURNS TRIGGER AS $$
DECLARE
    domain_number TEXT;
    document_version INTEGER;
    sequence_value BIGINT;
    version_number_text TEXT;
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
    ELSIF NEW.generated_template_id = 'order_cost_estimate' THEN
        SELECT q.quote_number
          INTO domain_number
          FROM quotes q
         WHERE q.order_id = NEW.order_id
         ORDER BY q.created_at DESC
         LIMIT 1;
    END IF;

    IF domain_number IS NOT NULL THEN
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

    IF NEW.generated_template_id = 'cost_estimate' THEN
        sequence_value := nextval('cost_estimate_document_number_seq');
        NEW.document_number := format(
            'VKS-%s-%s',
            to_char(COALESCE(NEW.document_date, CURRENT_DATE), 'YYYYMMDD'),
            lpad(sequence_value::text, 4, '0')
        );
        RETURN NEW;
    END IF;

    -- A signed scan, an electronically signed copy or an uploaded new version
    -- is the same document: it keeps the document's number.
    IF NEW.replaces_document_id IS NOT NULL THEN
        version_number_text := document_version_number(
            NEW.replaces_document_id,
            NEW.version_number
        );
        IF version_number_text IS NOT NULL THEN
            NEW.document_number := version_number_text;
            RETURN NEW;
        END IF;
    END IF;

    NEW.document_number := next_document_number(
        COALESCE(NEW.generated_template_id, NEW.art, '')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
