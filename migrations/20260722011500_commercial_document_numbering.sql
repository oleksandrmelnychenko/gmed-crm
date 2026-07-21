-- Commercial PDF versions retain a unique stored number while the rendered
-- document uses the stable business reference without the -Vxx suffix.
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
    ELSIF NEW.generated_template_id IN ('order_cost_estimate', 'cost_estimate') THEN
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

    prefix := CASE COALESCE(NEW.generated_template_id, NEW.art, '')
        WHEN 'confidentiality_release' THEN 'SE'
        WHEN 'privacy_consents' THEN 'EW'
        WHEN 'privacy_information' THEN 'DS'
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
