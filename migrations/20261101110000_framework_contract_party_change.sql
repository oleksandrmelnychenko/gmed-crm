-- A minor's paying parent alone is the Auftraggeber of the Rahmenvertrag too
-- (owner decision 2026-10-25, map item 94). Changed after signature, the order
-- and the Kostenvoranschlag named the new parent while the signed contract
-- stayed with the old one, unblocked (QA 2026-11-01, W2 N1). The change of the
-- party is recorded on the lead's contract: a framework document generated
-- before it is outdated, like an order document after a change of its terms.
ALTER TABLE framework_contracts
    ADD COLUMN IF NOT EXISTS party_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN framework_contracts.party_changed_at IS
    'Last change of the parent who contracts on an open lead; a framework document generated before it is outdated.';

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
            (o.client_terms_changed_at IS NULL
             OR source.generated_at >= o.client_terms_changed_at)
            AND (o.prepayment_terms_changed_at IS NULL
                 OR source.generated_at >= o.prepayment_terms_changed_at)
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
