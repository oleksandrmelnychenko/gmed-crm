-- Screens QA 2026-11-12, F-C8: a concierge service in the billing state
-- `ready` with a sale price is billed from the patient's billing tab. The
-- invoice line that bills it names the service here, so
--   * the same service is never billed twice (the API refuses a service that
--     a non-cancelled invoice already bills; the row lock on the service
--     serialises two drafts),
--   * the release of the invoice moves the service to `billed`, and the
--     cancellation of a released invoice moves it back to `ready`,
--   * the order economics count the billed sale price exactly instead of the
--     informational block of fix 41.
-- A cancelled draft keeps its rows for the record; every reader joins the
-- invoice and skips cancelled ones. Nothing existing changes.

CREATE TABLE IF NOT EXISTS invoice_concierge_service_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    concierge_service_id UUID NOT NULL REFERENCES concierge_services(id) ON DELETE RESTRICT,
    -- Position of the line in `invoices.line_items`.
    invoice_line_index INTEGER NOT NULL CHECK (invoice_line_index >= 0),
    quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
    unit_price_net NUMERIC(12, 2) NOT NULL CHECK (unit_price_net > 0),
    vat_rate NUMERIC NOT NULL CHECK (vat_rate BETWEEN 0 AND 100),
    amount_net NUMERIC(12, 2) NOT NULL CHECK (amount_net >= 0),
    amount_vat NUMERIC(12, 2) NOT NULL CHECK (amount_vat >= 0),
    amount_gross NUMERIC(12, 2) NOT NULL CHECK (amount_gross >= 0),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT invoice_concierge_service_lines_service_once UNIQUE (invoice_id, concierge_service_id),
    CONSTRAINT invoice_concierge_service_lines_line_once UNIQUE (invoice_id, invoice_line_index)
);

CREATE INDEX IF NOT EXISTS idx_invoice_concierge_service_lines_service
    ON invoice_concierge_service_lines (concierge_service_id);

COMMENT ON TABLE invoice_concierge_service_lines IS
    'Invoice lines that bill a concierge service at its sale price (F-C8, 2026-11-12). A service is billed by at most one non-cancelled invoice (checked by the API under a row lock on the service).';

-- A released invoice that billed a concierge service is cancelled (Storno):
-- the service is billable again. Only the invoice cancellation moves a
-- service from `billed` back to `ready`; the manual billing moves of the API
-- stay as they are. Same function as 20260929100000 plus that one pair.
CREATE OR REPLACE FUNCTION concierge_billing_transition_allowed(p_from TEXT, p_to TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT p_from = p_to
        OR (p_from, p_to) IN (
            ('draft', 'ready'),
            ('draft', 'waived'),
            ('ready', 'billed'),
            ('ready', 'waived'),
            ('ready', 'draft'),
            ('billed', 'ready'),
            ('billed', 'settled'),
            ('billed', 'reversed'),
            ('settled', 'reversed'),
            ('waived', 'draft'),
            ('reversed', 'draft')
        )
$$;
