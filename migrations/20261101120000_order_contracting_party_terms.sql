-- The Kostenvoranschlag prints the Auftraggeber (QA 2026-11-01, V2): after a
-- change of the paying parent it kept «Auftraggeber: Georg», read as current,
-- blocked nothing and the lead converted. It stays current after a change of a
-- third-party payer, whom it does not print (20261101100100), so the change of
-- the party has its own column on the order, written with the framework
-- contract's `party_changed_at`.
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS contracting_party_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN orders.contracting_party_changed_at IS
    'Last change of the parents who contract on the source lead; an estimate or a cost coverage declaration generated before it names the previous Auftraggeber.';

CREATE OR REPLACE FUNCTION document_terms_current(target UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN d.generated_template_id = 'single_order' AND o.id IS NOT NULL THEN
            source.generated_at >= COALESCE(
                GREATEST(o.client_terms_changed_at, o.payer_terms_changed_at),
                source.generated_at)
        WHEN d.generated_template_id = 'order_cost_estimate' AND o.id IS NOT NULL THEN
            source.generated_at >= COALESCE(
                GREATEST(o.client_terms_changed_at,
                         o.prepayment_terms_changed_at,
                         o.contracting_party_changed_at),
                source.generated_at)
        WHEN d.generated_template_id = 'framework_contract' THEN
            source.generated_at >= (
                SELECT MAX(fc.party_changed_at)
                FROM framework_contracts fc
                WHERE fc.lead_id = d.lead_id)
        ELSE NULL
    END
    FROM documents d
    LEFT JOIN orders o ON o.id = d.order_id
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
