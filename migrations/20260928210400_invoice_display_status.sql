-- A released invoice whose credit notes cover its whole total is settled by
-- the correction, not by a payment: it is shown as "credited" (RU
-- "Сторнирован", DE "Storniert") instead of "paid". The stored status stays
-- `paid` (the payment journal derives it); lists, filters, the patient portal
-- and statements use this display status. A partly credited invoice keeps its
-- real paid/open status.

CREATE OR REPLACE FUNCTION invoice_display_status(
    status TEXT,
    total_gross NUMERIC,
    credited_amount NUMERIC
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT CASE
        WHEN status NOT IN ('draft', 'cancelled')
             AND total_gross > 0
             AND COALESCE(credited_amount, 0) >= total_gross
            THEN 'credited'
        ELSE status
    END
$$;

COMMENT ON FUNCTION invoice_display_status(TEXT, NUMERIC, NUMERIC) IS
    'Status shown to users: credited for a released invoice fully covered by credit notes, else the stored status.';
