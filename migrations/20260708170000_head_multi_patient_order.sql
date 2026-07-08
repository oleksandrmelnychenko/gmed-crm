-- Head / multi-patient order model (#1, #3, #4, #7). Additive columns only.
--
-- Grouping + MAIN + merge (#4): a 'main' order groups 'sub' orders via
-- head_order_id; order_role marks each order's place in the group. Payer (#7):
-- an order (typically the head) can designate who pays — e.g. the father — via a
-- patient relation or a free-text contact, mirroring the payer already on invoices.
-- Multiple patients (#1/#3) are derived from the group's appointments/sub-orders;
-- no new junction table is needed.
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS head_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS order_role TEXT NOT NULL DEFAULT 'standalone'
        CHECK (order_role IN ('standalone', 'main', 'sub')),
    ADD COLUMN IF NOT EXISTS payer_patient_relation_id UUID
        REFERENCES patient_relations(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS payer_contact_name TEXT,
    ADD COLUMN IF NOT EXISTS payer_contact_email TEXT,
    ADD COLUMN IF NOT EXISTS payer_contact_phone TEXT,
    ADD COLUMN IF NOT EXISTS payer_contact_relationship TEXT,
    ADD COLUMN IF NOT EXISTS payer_notes TEXT,
    ADD COLUMN IF NOT EXISTS payer_updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS payer_updated_at TIMESTAMPTZ;

-- A 'sub' order always points at its head; 'main'/'standalone' never do.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'orders_sub_has_head_chk'
          AND conrelid = 'orders'::regclass
    ) THEN
        ALTER TABLE orders
            ADD CONSTRAINT orders_sub_has_head_chk
            CHECK ((order_role = 'sub') = (head_order_id IS NOT NULL));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_head_order_id
    ON orders (head_order_id)
    WHERE head_order_id IS NOT NULL;
