ALTER TABLE orders ADD COLUMN prepayment_due_at TIMESTAMPTZ;

CREATE VIEW order_payment_tracking AS
WITH amounts AS (
    SELECT o.id AS order_id, o.order_number, o.patient_id, o.source_lead_id,
           o.currency, o.prepayment_required, o.signed_patient AND o.signed_agency AS signed,
           o.prepayment_due_at,
           COALESCE(NULLIF(o.prepayment_amount, 0), quote.total_gross, 0) AS required_amount,
           order_recorded_cash_paid(o.id) AS received_amount,
           EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id
                   AND i.status NOT IN ('draft', 'cancelled')) AS invoice_exists
    FROM orders o
    LEFT JOIN LATERAL (SELECT total_gross FROM quotes WHERE order_id=o.id
                       ORDER BY created_at DESC,id DESC LIMIT 1) quote ON true
    WHERE o.status <> 'cancelled'
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

-- One durable snapshot per order prevents duplicate notices after retries/restarts.
CREATE TABLE order_payment_notification_state (
    order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
    payment_status TEXT NOT NULL,
    required_amount NUMERIC NOT NULL,
    received_amount NUMERIC NOT NULL,
    due_at TIMESTAMPTZ,
    signed BOOLEAN NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
