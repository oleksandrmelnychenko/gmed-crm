-- Cancelling an order requires a reason (orders.cancellation_reason, the
-- free text entered by staff; 'contract_terminated' stays reserved for
-- contract terminations) and now also records who cancelled it. The
-- cancellation cancels the order's planned services, upcoming appointments,
-- open quotes and pending amount amendments in the same transaction; what was
-- delivered or invoiced stays as the basis for final billing or a refund.
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN orders.cancelled_by IS
    'Staff member who cancelled the order; NULL for orders cancelled before this was recorded or by a contract termination.';
