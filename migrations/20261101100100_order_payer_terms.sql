-- The Einzelauftrag prints who pays (QA 2026-11-01, Z2 BUG-1): moved to
-- self-pay, it still read «übernimmt ein Dritter - …», could be signed and the
-- lead converted. A change of the payer an order document prints makes the
-- documents generated before it outdated, like a change of the client's terms.
-- It has its own column: the Kostenvoranschlag prints no payer, and is reused,
-- so it stays current.
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS payer_terms_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN orders.payer_terms_changed_at IS
    'Last change of the payer an order document prints; a single order generated before it is outdated.';

CREATE OR REPLACE FUNCTION orders_record_payer_terms_change()
RETURNS TRIGGER AS $$
BEGIN
    IF (OLD.payer_role, OLD.payer_patient_id, OLD.payer_patient_relation_id,
        OLD.payer_contact_name, OLD.payer_contact_email, OLD.payer_contact_phone,
        OLD.payer_address_street, OLD.payer_address_zip, OLD.payer_address_city,
        OLD.payer_address_country, OLD.payer_contact_is_organisation)
       IS DISTINCT FROM
       (NEW.payer_role, NEW.payer_patient_id, NEW.payer_patient_relation_id,
        NEW.payer_contact_name, NEW.payer_contact_email, NEW.payer_contact_phone,
        NEW.payer_address_street, NEW.payer_address_zip, NEW.payer_address_city,
        NEW.payer_address_country, NEW.payer_contact_is_organisation)
    THEN
        -- clock_timestamp(): a document generated later in the same
        -- transaction (now()) must still count as made after the change.
        NEW.payer_terms_changed_at := clock_timestamp();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_record_payer_terms_change ON orders;
CREATE TRIGGER orders_record_payer_terms_change
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION orders_record_payer_terms_change();

CREATE OR REPLACE FUNCTION document_terms_current(target UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN d.generated_template_id = 'single_order' THEN
            source.generated_at >= COALESCE(
                GREATEST(o.client_terms_changed_at, o.payer_terms_changed_at),
                source.generated_at)
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
