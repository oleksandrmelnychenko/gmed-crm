-- A cancelled invoice left its package consumptions linked, and only unlinked
-- ones are billed: an approved overage could never be billed again (QA
-- 2026-10-31). Cancelling now clears the link; this frees what earlier
-- cancellations left behind.

UPDATE service_package_consumptions consumption
SET invoice_id = NULL
FROM invoices invoice
WHERE invoice.id = consumption.invoice_id
  AND invoice.status = 'cancelled';
