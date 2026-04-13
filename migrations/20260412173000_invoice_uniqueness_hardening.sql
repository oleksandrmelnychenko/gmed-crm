CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_quote_active_advance
    ON invoices(quote_id)
    WHERE quote_id IS NOT NULL
      AND invoice_type = 'advance'
      AND status <> 'cancelled';

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_quote_active_settlement
    ON invoices(quote_id)
    WHERE quote_id IS NOT NULL
      AND invoice_type IN ('interim', 'final')
      AND status <> 'cancelled';
