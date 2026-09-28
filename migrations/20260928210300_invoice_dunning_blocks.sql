-- Dunning block (Mahnsperre) per invoice: billing or the CEO stops automatic
-- reminders and the automatic overdue escalation of an invoice, e.g. while a
-- payment arrangement or a dispute is open. Setting and clearing a block both
-- need a reason; the rows are the history (a block is cleared once, never
-- edited or deleted).

CREATE TABLE invoice_dunning_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
    blocked_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    blocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    cleared_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    cleared_at TIMESTAMPTZ,
    clear_reason TEXT,
    CONSTRAINT invoice_dunning_block_cleared_shape CHECK (
        (cleared_at IS NULL AND cleared_by IS NULL AND clear_reason IS NULL)
        OR (
            cleared_at IS NOT NULL
            AND cleared_by IS NOT NULL
            AND char_length(btrim(clear_reason)) BETWEEN 3 AND 1000
        )
    )
);

CREATE UNIQUE INDEX uq_invoice_dunning_blocks_active
    ON invoice_dunning_blocks(invoice_id)
    WHERE cleared_at IS NULL;

CREATE INDEX idx_invoice_dunning_blocks_invoice
    ON invoice_dunning_blocks(invoice_id, blocked_at DESC);

CREATE OR REPLACE FUNCTION protect_invoice_dunning_block()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.cleared_at IS NOT NULL
        OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
        OR NEW.reason IS DISTINCT FROM OLD.reason
        OR NEW.blocked_by IS DISTINCT FROM OLD.blocked_by
        OR NEW.blocked_at IS DISTINCT FROM OLD.blocked_at
    THEN
        RAISE EXCEPTION 'a dunning block can only be cleared once'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

-- Deleting an invoice (only drafts can be) removes its blocks by cascade;
-- the trigger protects the history of existing invoices.
CREATE TRIGGER protect_invoice_dunning_block_trigger
    BEFORE UPDATE ON invoice_dunning_blocks
    FOR EACH ROW
    EXECUTE FUNCTION protect_invoice_dunning_block();

-- Days after the due date (Berlin calendar) before the first automatic
-- payment reminder; 0 sends it the day after the due date as before.
INSERT INTO system_settings (key, value, description)
VALUES (
    'auto_dunning_grace_days',
    '7',
    'Days after the invoice due date before the first automatic payment reminder'
)
ON CONFLICT (key) DO NOTHING;
