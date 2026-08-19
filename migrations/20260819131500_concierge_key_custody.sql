ALTER TABLE concierge_services
    ADD COLUMN key_status TEXT CHECK (
        key_status IN ('received', 'stored', 'handed_over', 'returned')
    ),
    ADD COLUMN key_responsible_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN key_status_at TIMESTAMPTZ;

CREATE INDEX idx_concierge_services_key_responsible
    ON concierge_services(key_responsible_user_id)
    WHERE key_responsible_user_id IS NOT NULL;

CREATE TABLE concierge_service_key_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    concierge_service_id UUID NOT NULL REFERENCES concierge_services(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK (
        action IN ('received', 'stored', 'handed_over', 'returned')
    ),
    responsible_user_id UUID NOT NULL REFERENCES users(id),
    occurred_at TIMESTAMPTZ NOT NULL,
    note TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
    recorded_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_concierge_service_key_events_service_time
    ON concierge_service_key_events(concierge_service_id, occurred_at DESC, created_at DESC);
