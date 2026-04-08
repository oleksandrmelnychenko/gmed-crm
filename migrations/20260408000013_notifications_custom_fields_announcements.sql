CREATE TABLE IF NOT EXISTS notification_channels (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_type TEXT NOT NULL CHECK (channel_type IN ('smtp', 'webhook')),
    name        TEXT NOT NULL,
    config      JSONB NOT NULL DEFAULT '{}',
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS custom_fields (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('lead', 'patient', 'order', 'provider')),
    field_key   TEXT NOT NULL,
    field_label TEXT NOT NULL,
    field_type  TEXT NOT NULL DEFAULT 'text' CHECK (field_type IN ('text', 'number', 'date', 'boolean', 'select')),
    options     JSONB,
    is_required BOOLEAN NOT NULL DEFAULT false,
    sort_order  INT NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (entity_type, field_key)
);

CREATE TABLE IF NOT EXISTS custom_field_values (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    field_id    UUID NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
    entity_id   UUID NOT NULL,
    value       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (field_id, entity_id)
);

CREATE INDEX idx_cfv_entity ON custom_field_values(entity_id);
CREATE INDEX idx_cfv_field ON custom_field_values(field_id);

CREATE TABLE IF NOT EXISTS announcements (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       TEXT NOT NULL,
    message     TEXT NOT NULL,
    variant     TEXT NOT NULL DEFAULT 'info' CHECK (variant IN ('info', 'warning', 'error', 'success')),
    is_active   BOOLEAN NOT NULL DEFAULT true,
    starts_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    ends_at     TIMESTAMPTZ,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
