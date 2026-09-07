-- Bootstrap compatibility before the quantity-allocation backfill. Preserve all
-- deployed migration checksums. On databases that passed the backfill this is a
-- no-op. Only the fixed historical demo IDs and their old `qty` format qualify.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM _sqlx_migrations WHERE version = 20260819113000 AND success) THEN
        RETURN;
    END IF;
    UPDATE quotes quote
    SET line_items = (
        SELECT jsonb_agg(CASE WHEN item ? 'qty' AND NOT item ? 'quantity'
            THEN item || jsonb_build_object('quantity', item->'qty') ELSE item END ORDER BY ordinality)
        FROM jsonb_array_elements(quote.line_items) WITH ORDINALITY AS line(item, ordinality)
    )
    WHERE quote.id IN (
        '12100000-0000-0000-0000-000000000003',
        '12100000-0000-0000-0000-000000000004',
        '12100000-0000-0000-0000-000000000005'
    ) AND quote.quote_number IN ('QT-2026-003', 'QT-2026-004', 'QT-2026-005');
END;
$$;
