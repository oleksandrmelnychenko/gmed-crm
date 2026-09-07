-- Quotes are commercial snapshots. Payment truth comes from the cash journals,
-- including refund/reversal signs; allocated advances are not a second receipt.
CREATE FUNCTION order_recorded_cash_paid(order_uuid UUID) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
    SELECT COALESCE((SELECT SUM(CASE WHEN p.transaction_type = 'payment' THEN p.amount_gross ELSE -p.amount_gross END)
        FROM invoice_payment_transactions p JOIN invoices i ON i.id = p.invoice_id
        WHERE i.order_id = order_uuid AND i.status NOT IN ('draft', 'cancelled')), 0)
      - COALESCE((SELECT SUM(CASE WHEN r.transaction_type = 'refund' THEN r.amount_gross ELSE -r.amount_gross END)
        FROM invoice_refund_transactions r JOIN invoices i ON i.id = r.invoice_id
        WHERE i.order_id = order_uuid AND i.status NOT IN ('draft', 'cancelled')), 0);
$$;

CREATE FUNCTION protect_quote_cash_amount() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.paid_amount IS DISTINCT FROM OLD.paid_amount THEN
        RAISE EXCEPTION 'Record or reverse cash through invoice payment journals, not quotes';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_quote_cash_amount_trigger BEFORE UPDATE OF paid_amount ON quotes
    FOR EACH ROW EXECUTE FUNCTION protect_quote_cash_amount();

CREATE FUNCTION order_recorded_cash_received_at(order_uuid UUID) RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN order_recorded_cash_paid(order_uuid) > 0 THEN MAX(p.received_on)::TIMESTAMPTZ END
    FROM invoice_payment_transactions p JOIN invoices i ON i.id = p.invoice_id
    WHERE i.order_id = order_uuid AND i.status NOT IN ('draft', 'cancelled')
      AND p.transaction_type = 'payment'
      AND NOT EXISTS (SELECT 1 FROM invoice_payment_transactions reversal WHERE reversal.reverses_transaction_id = p.id);
$$;
