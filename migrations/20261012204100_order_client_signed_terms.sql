-- The client's signature of an order covers the terms it was given for
-- (QA C3-01, 2026-10-12).
--
-- A single order (Einzelauftrag) signed by the client — scan of the signed
-- copy or QES — stayed "signed" after staff changed its services or its
-- programme period (3 h → 4 h interpreter, 889,15 € → 1.002,20 €): no
-- warning, no new document version, the signature proved a document whose
-- content no longer matched the order.
--
-- The terms of an order are its not cancelled services (description,
-- quantity, unit price, VAT rate, pass-through), its programme period and its
-- gross total (`order_client_terms`). Staff edits that change the terms of an
-- order the client signed are refused unless they confirm the reset of the
-- signature (409 `order_signed_terms_change`, orders.rs); with the
-- confirmation the client's and GMED's order signatures are reset in the same
-- transaction. Every staff change of the terms records `client_terms_changed_at`:
-- an order document generated before it no longer counts as the signed
-- version (paper signature 409 `order_document_outdated`, a QES of it leaves
-- the order unsigned). `client_signed_terms` keeps the terms of the last
-- client signature (with `signed_at` and `document_id`), so the order shows
-- which version the client signed and that changes await a new signature.
-- Billing actuals (approved interpreter hours, completed appointments,
-- approved amendments) are not staff edits of the terms: they keep the
-- signature, and the signed total is shown next to the current one.

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS client_signed_terms JSONB,
    ADD COLUMN IF NOT EXISTS client_terms_changed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS client_terms_changed_by UUID REFERENCES users(id);

COMMENT ON COLUMN orders.client_signed_terms IS
    'Terms of the order (order_client_terms) at the last client signature, with signed_at and document_id.';
COMMENT ON COLUMN orders.client_terms_changed_at IS
    'Last staff change of the order terms; order documents generated before it are outdated.';

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
    )
    FROM orders o
    WHERE o.id = target
$$;

COMMENT ON FUNCTION order_client_terms(UUID) IS
    'What the client signs in an order: not cancelled services, programme period and gross total.';

-- Orders signed before this rule: their current terms are the best record of
-- the signed version (marked as recorded by the migration).
UPDATE orders
SET client_signed_terms = order_client_terms(id)
        || jsonb_build_object(
            'signed_at', COALESCE(signed_patient_at, signed_at),
            'recorded_by_migration', true
        )
WHERE signed_patient
  AND client_signed_terms IS NULL;
