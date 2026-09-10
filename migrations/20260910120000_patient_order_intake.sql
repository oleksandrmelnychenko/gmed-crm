-- Preparation is independent of operational phase/status. Existing orders keep
-- their workflow and do not acquire fabricated confirmations.
ALTER TABLE orders ADD COLUMN intake_state TEXT NOT NULL DEFAULT 'legacy'
    CHECK (intake_state IN ('legacy', 'draft', 'confirmed'));
ALTER TABLE orders ADD CONSTRAINT order_intake_phase
    CHECK (intake_state <> 'draft' OR (phase = 'discovery' AND status IN ('active', 'cancelled')));

CREATE TABLE order_intakes (
    order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL DEFAULT 0,
    data JSONB NOT NULL,
    prepared_data JSONB,
    baseline_facts JSONB NOT NULL,
    confirmed_facts JSONB,
    facts_confirmed_at TIMESTAMPTZ,
    facts_confirmed_by UUID REFERENCES users(id),
    confirmed_at TIMESTAMPTZ,
    confirmed_by UUID REFERENCES users(id),
    confirmation_snapshot JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_intake_fact_reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES order_intakes(order_id),
    before_facts JSONB NOT NULL,
    after_facts JSONB NOT NULL,
    confirmed_by UUID NOT NULL REFERENCES users(id),
    confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE documents ADD COLUMN order_intake_context JSONB;
-- A signed replacement inherits the exact source context, never the context of
-- an order edited while a signature request was in flight.
CREATE FUNCTION inherit_order_intake_document_context() RETURNS trigger AS $$
BEGIN
    IF NEW.order_intake_context IS NULL AND NEW.replaces_document_id IS NOT NULL THEN
        SELECT order_intake_context INTO NEW.order_intake_context
        FROM documents WHERE id = NEW.replaces_document_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER document_intake_context BEFORE INSERT ON documents
    FOR EACH ROW EXECUTE FUNCTION inherit_order_intake_document_context();

-- Preparation must not create invoices or appointments through another screen.
CREATE FUNCTION require_confirmed_order_intake() RETURNS trigger AS $$
BEGIN
    IF NEW.order_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM orders WHERE id = NEW.order_id AND intake_state = 'draft'
    ) THEN
        RAISE EXCEPTION 'Complete order preparation before creating operational records' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER invoice_order_intake BEFORE INSERT OR UPDATE OF order_id ON invoices
    FOR EACH ROW EXECUTE FUNCTION require_confirmed_order_intake();
CREATE TRIGGER appointment_order_intake BEFORE INSERT OR UPDATE OF order_id ON appointments
    FOR EACH ROW EXECUTE FUNCTION require_confirmed_order_intake();

-- Preserve cash history, while new drafts never enter automated payment tracking.
CREATE OR REPLACE VIEW order_payment_tracking AS
WITH amounts AS (
    SELECT o.id AS order_id, o.order_number, o.patient_id, o.source_lead_id,
           o.currency, o.prepayment_required, o.signed_patient AND o.signed_agency AS signed,
           o.prepayment_due_at,
           COALESCE(NULLIF(o.prepayment_amount, 0), quote.total_gross, 0) AS required_amount,
           order_recorded_cash_paid(o.id) AS received_amount,
           EXISTS (SELECT 1 FROM invoices i WHERE i.order_id=o.id
                   AND i.status NOT IN ('draft', 'cancelled')) AS invoice_exists
    FROM orders o
    LEFT JOIN LATERAL (SELECT total_gross FROM quotes WHERE order_id=o.id
                       ORDER BY created_at DESC,id DESC LIMIT 1) quote ON true
    WHERE o.status <> 'cancelled' AND o.intake_state <> 'draft'
), positions AS (
    SELECT *, CASE WHEN prepayment_required THEN GREATEST(required_amount-received_amount,0)
                   ELSE 0 END AS remaining_amount FROM amounts
)
SELECT *, CASE
    WHEN NOT prepayment_required THEN 'not_required'
    WHEN required_amount <= 0 THEN 'not_configured'
    WHEN remaining_amount = 0 THEN 'paid'
    WHEN prepayment_due_at <= now() THEN 'overdue'
    WHEN prepayment_due_at <= now() + interval '24 hours' THEN 'due_soon'
    WHEN received_amount > 0 THEN 'partially_paid'
    WHEN NOT invoice_exists THEN 'awaiting_invoice'
    ELSE 'awaiting_payment'
END AS payment_status
FROM positions;
