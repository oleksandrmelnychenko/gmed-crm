-- A follow-up quote adds to the order estimate instead of replacing it
-- (QA D3-06, 2026-10-12).
--
-- A quote covers the order services that are not invoiced yet, so a quote
-- for an extra service covers that service only. Creating it wrote its total
-- into `orders.total_estimated` (an order worth 2.091,08 € showed 113,05 €
-- there) and checked the required prepayment against it, which refused every
-- extra service below the prepayment. The server now keeps the whole order
-- (every service that is not cancelled) as the estimate.
--
-- Orders whose estimate was overwritten that way are repaired: an order with
-- an invoiced service and a stored estimate below its services gets the
-- services' total back. Draft intakes are left alone (their services are not
-- invoiced, and a changed estimate would reset a repeat order's signatures).

UPDATE orders
SET total_estimated = order_service_total_gross(id),
    updated_at = now()
WHERE intake_state IS DISTINCT FROM 'draft'
  AND order_service_total_gross(id) IS NOT NULL
  AND total_estimated IS DISTINCT FROM order_service_total_gross(id)
  AND (total_estimated IS NULL OR total_estimated < order_service_total_gross(id))
  AND EXISTS (
      SELECT 1
      FROM order_leistungen service
      WHERE service.order_id = orders.id
        AND service.status = 'invoiced'
  );
