-- QA 2026-10-31: the terms an order is signed for are its services, programme
-- period, prepayment and gross total (owner rule).
--
-- 1. `order_client_terms` left the prepayment out, so a changed prepayment kept
--    the signature. It is part of the terms now: a change on a signed order
--    asks for the confirmation and resets the signatures (`client_terms.rs`).
--    Stored `client_signed_terms` keep the shape they were signed with; only
--    their total, period and date are read back.
--
-- 2. A BEFORE UPDATE trigger reset the signatures of a repeat draft by itself,
--    with no confirmation and no audit row, and also for the fields that are
--    no signed terms. Staff edits go through `client_terms::settle`, so the
--    trigger goes. A repeat draft's documents also print its purpose and name
--    its contract (`repeat_order_document_context`), so on such a draft these
--    two still count: their change resets the signatures as before, but with
--    the confirmation and the audit row. The trigger on the service lines stays
--    as the net under direct edits; every route already settles before it fires.
CREATE OR REPLACE FUNCTION order_client_terms(target UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
    SELECT jsonb_build_object(
        'date_from', o.date_from,
        'date_to', o.date_to,
        'currency', UPPER(o.currency),
        'total_gross', COALESCE(order_service_total_gross(o.id), o.total_estimated),
        'prepayment_required', o.prepayment_required,
        'prepayment_amount', o.prepayment_amount,
        'prepayment_due_at', o.prepayment_due_at,
        'lines', COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', line.id,
                    'description', line.description,
                    'quantity', line.quantity,
                    'unit_price', line.unit_price_snapshot,
                    'vat_rate', line.vat_rate_snapshot,
                    'is_cost_passthrough', line.is_cost_passthrough
                )
                ORDER BY line.created_at, line.id
            )
            FROM order_leistungen line
            WHERE line.order_id = o.id
              AND line.status <> 'cancelled'
        ), '[]'::jsonb)
    ) || CASE
        WHEN o.intake_state = 'draft' AND EXISTS (
            SELECT 1 FROM leads l
            WHERE l.id = o.source_lead_id AND l.repeat_patient_id IS NOT NULL
        ) THEN jsonb_build_object(
            'needs_description', o.needs_description,
            'contract_id', o.contract_id
        )
        ELSE '{}'::jsonb
    END
    FROM orders o
    WHERE o.id = target
$$;

COMMENT ON FUNCTION order_client_terms(UUID) IS
    'What the client signs in an order: not cancelled services, programme period, prepayment and gross total; on a repeat draft also the purpose and the contract its documents print.';

DROP TRIGGER IF EXISTS repeat_order_signatures ON orders;
DROP FUNCTION IF EXISTS invalidate_repeat_order_signatures();
