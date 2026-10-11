-- QA 2026-10-11 (D-23): a quote showed the whole order's cash. A new draft
-- quote of an order looked paid ("Оплачен 1.079,58 €") while the quote that
-- was invoiced and paid looked unpaid. Cash now belongs to the quote whose
-- issued invoices received it, read from the payment and refund journals
-- (credit transfers move with their legs). Advance money credited from an
-- advance invoice of one quote into an invoice of another quote moves with
-- the allocation. Invoices without a quote count for no quote.
--
-- Forward-only: no data changes. `quotes.paid_amount` stays a frozen legacy
-- column (protected by `protect_quote_cash_amount`), and stored quote
-- versions keep the figures they were written with.

CREATE OR REPLACE FUNCTION quote_recorded_cash_paid(quote_uuid UUID) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
    WITH quote_invoices AS (
        SELECT invoice.id
        FROM invoices invoice
        WHERE invoice.quote_id = quote_uuid
          AND invoice.status NOT IN ('draft', 'cancelled')
    )
    SELECT COALESCE((
               SELECT SUM(CASE WHEN payment.transaction_type = 'payment'
                               THEN payment.amount_gross ELSE -payment.amount_gross END)
               FROM invoice_payment_transactions payment
               JOIN quote_invoices invoice ON invoice.id = payment.invoice_id
           ), 0)
         - COALESCE((
               SELECT SUM(CASE WHEN refund.transaction_type = 'refund'
                               THEN refund.amount_gross ELSE -refund.amount_gross END)
               FROM invoice_refund_transactions refund
               JOIN quote_invoices invoice ON invoice.id = refund.invoice_id
           ), 0)
         + COALESCE((
               SELECT SUM(allocation.amount_gross)
               FROM invoice_prepayment_allocations allocation
               JOIN quote_invoices target ON target.id = allocation.target_invoice_id
               JOIN invoices advance ON advance.id = allocation.advance_invoice_id
               WHERE advance.quote_id IS DISTINCT FROM quote_uuid
           ), 0)
         - COALESCE((
               SELECT SUM(allocation.amount_gross)
               FROM invoice_prepayment_allocations allocation
               JOIN quote_invoices advance ON advance.id = allocation.advance_invoice_id
               JOIN invoices target ON target.id = allocation.target_invoice_id
               WHERE target.quote_id IS DISTINCT FROM quote_uuid
           ), 0);
$$;

CREATE OR REPLACE FUNCTION quote_recorded_cash_received_at(quote_uuid UUID) RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN quote_recorded_cash_paid(quote_uuid) > 0
                THEN MAX(payment.received_on)::TIMESTAMPTZ END
    FROM invoice_payment_transactions payment
    JOIN invoices invoice ON invoice.id = payment.invoice_id
    WHERE invoice.quote_id = quote_uuid
      AND invoice.status NOT IN ('draft', 'cancelled')
      AND payment.transaction_type = 'payment'
      AND NOT EXISTS (
          SELECT 1 FROM invoice_payment_transactions reversal
          WHERE reversal.reverses_transaction_id = payment.id
      );
$$;

COMMENT ON FUNCTION quote_recorded_cash_paid(UUID) IS
    'Cash received for one quote: payments minus refunds of its issued invoices, plus advance money of other quotes credited into them, minus its advance money credited into invoices of other quotes.';
