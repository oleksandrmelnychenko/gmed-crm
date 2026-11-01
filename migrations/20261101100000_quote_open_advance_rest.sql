-- What released advances covering a quote still ask for and nobody paid. An
-- advance consumes no quote quantity, so an interim invoice has to leave this
-- much of the quote unbilled (QA 2026-11-01, Z1 N1). Paid money is no demand:
-- it stays available for the order's invoices (doc 9.2). The advances are the
-- ones a final invoice of this quote would settle.
CREATE OR REPLACE FUNCTION quote_open_advance_rest(target_quote_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(SUM(GREATEST(
               advance.total_gross - advance.credited_amount
               - GREATEST(advance.paid_amount, COALESCE(allocated.amount, 0)),
               0
           )), 0)::NUMERIC
    FROM quotes quote
    JOIN invoices advance ON advance.order_id = quote.order_id
    LEFT JOIN quotes advance_quote ON advance_quote.id = advance.quote_id
    LEFT JOIN LATERAL (
        SELECT SUM(allocation.amount_gross) AS amount
        FROM invoice_prepayment_allocations allocation
        WHERE allocation.advance_invoice_id = advance.id
    ) allocated ON TRUE
    WHERE quote.id = target_quote_id
      AND advance.invoice_type = 'advance'
      AND advance.status NOT IN ('draft', 'cancelled')
      AND (advance.quote_id IS NULL
           OR advance.quote_id = quote.id
           OR advance_quote.status IN ('superseded', 'rejected', 'expired'))
$$;

COMMENT ON FUNCTION quote_open_advance_rest(UUID) IS
    'Unpaid rest of the released advances a final invoice of this quote would settle.';
