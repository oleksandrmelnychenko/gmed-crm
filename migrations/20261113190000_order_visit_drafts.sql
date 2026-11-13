-- Planning grid drafts (owner 2026-11-13): in a lead's order the planner
-- lays the doctors out on days and hours before the patient exists. Drafts
-- are no appointments: they block nobody's time, reach no portal and notify
-- nobody. Once the order has its patient, the grid shows them and «Создать
-- все приёмы» turns them into visits (and removes them).
CREATE TABLE IF NOT EXISTS order_visit_drafts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    doctor_id UUID REFERENCES provider_doctors(id) ON DELETE SET NULL,
    title TEXT NOT NULL CHECK (btrim(title) <> ''),
    date DATE NOT NULL,
    time_start TIME NOT NULL,
    time_end TIME NOT NULL CHECK (time_end > time_start),
    interpreter_needed BOOLEAN NOT NULL DEFAULT false,
    interpreter_id UUID REFERENCES users(id) ON DELETE SET NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_visit_drafts_order
    ON order_visit_drafts(order_id, position);
