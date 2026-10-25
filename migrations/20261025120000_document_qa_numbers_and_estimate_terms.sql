-- QA of the generated documents, 2026-10-25.
--
-- 1. Numbers: the lead's patient form ("Patientenformular – Angaben und
--    Erklärungen", `lead_self_disclosure`) gets its own prefix `PF-` instead
--    of the generic `DOC-`; the payer's copy of a Kostenvoranschlag
--    (`payer_cost_estimate`, "Anlage zur Kostenübernahmeerklärung") is a
--    document of its own and no longer carries the client's number: it is
--    numbered in the quote's series with the suffix `-Z` (Zahler) and a
--    version suffix, `KV-20261024-0002-Z-V01`, like the client's
--    `KV-20261024-0002-V01`. Numbers already assigned are not changed (GoBD).
--
-- 2. The Kostenvoranschlag goes stale when the prepayment terms of the order
--    change after it was generated ("Eine Vorauszahlung … ist nicht
--    vereinbart" while a prepayment is now required). Every change of
--    `prepayment_required`, `prepayment_amount` or `prepayment_due_at`
--    records `prepayment_terms_changed_at`; `document_terms_current(id)`
--    says whether an order document (services, period) or an estimate
--    (services, period, prepayment) still shows the order's terms. An
--    outdated estimate cannot be signed on paper (409
--    `estimate_document_outdated`, like `order_document_outdated`), the
--    document list shows `terms_current`, and the payer's package is blocked
--    while the client's estimate is outdated.

-- 1a. Prefix of the patient form.
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
        WHEN 'lead_self_disclosure' THEN 'PF'
        ELSE 'DOC'
    END
$$ LANGUAGE sql IMMUTABLE;

-- 1b. The payer's copy of the estimate in the quote's series, suffix `-Z`.
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
    ELSIF NEW.generated_template_id = 'payer_cost_estimate' THEN
        -- The payer's copy: the client's quote number with the suffix `-Z`
        -- (its own document, its own version count).
        SELECT q.quote_number || '-Z'
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

-- 2a. The last change of the order's prepayment terms.
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS prepayment_terms_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN orders.prepayment_terms_changed_at IS
    'Last change of prepayment_required, prepayment_amount or prepayment_due_at; a Kostenvoranschlag generated before it is outdated.';

CREATE OR REPLACE FUNCTION orders_record_prepayment_terms_change()
RETURNS TRIGGER AS $$
BEGIN
    IF (OLD.prepayment_required, OLD.prepayment_amount, OLD.prepayment_due_at)
       IS DISTINCT FROM
       (NEW.prepayment_required, NEW.prepayment_amount, NEW.prepayment_due_at)
    THEN
        -- clock_timestamp(): a document generated later in the same
        -- transaction (now()) must still count as made after the change.
        NEW.prepayment_terms_changed_at := clock_timestamp();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_record_prepayment_terms_change ON orders;
CREATE TRIGGER orders_record_prepayment_terms_change
    BEFORE UPDATE OF prepayment_required, prepayment_amount, prepayment_due_at ON orders
    FOR EACH ROW
    EXECUTE FUNCTION orders_record_prepayment_terms_change();

-- 2b. Whether an order document or a Kostenvoranschlag still shows the
--     order's terms. The age that counts is the generated document's: a
--     signed scan or an electronically signed copy is a version of the
--     generated document it was made from. A document generated in the same
--     instant as the change is current (generation clamps `created_at` to
--     the change). NULL for every other document and for one without an
--     order.
CREATE OR REPLACE FUNCTION document_terms_current(target UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN d.generated_template_id = 'single_order' THEN
            o.client_terms_changed_at IS NULL
            OR source.generated_at >= o.client_terms_changed_at
        WHEN d.generated_template_id = 'order_cost_estimate' THEN
            (o.client_terms_changed_at IS NULL
             OR source.generated_at >= o.client_terms_changed_at)
            AND (o.prepayment_terms_changed_at IS NULL
                 OR source.generated_at >= o.prepayment_terms_changed_at)
        ELSE NULL
    END
    FROM documents d
    JOIN orders o ON o.id = d.order_id
    CROSS JOIN LATERAL (
        SELECT COALESCE(
            (SELECT original.created_at
             FROM documents original
             WHERE original.id = d.replaces_document_id
               AND d.ursprung IN ('paper_signature', 'electronic_signature')),
            d.created_at
        ) AS generated_at
    ) source
    WHERE d.id = target
$$;
