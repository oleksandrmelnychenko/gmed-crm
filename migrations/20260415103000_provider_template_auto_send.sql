ALTER TABLE provider_templates
    ADD COLUMN IF NOT EXISTS auto_send_on_confirmed_appointment BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS appointment_provider_template_deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    template_id UUID NOT NULL REFERENCES provider_templates(id) ON DELETE CASCADE,
    document_id UUID NULL REFERENCES documents(id) ON DELETE SET NULL,
    triggered_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    delivery_status TEXT NOT NULL DEFAULT 'processing'
        CHECK (delivery_status IN ('processing', 'delivered', 'failed')),
    error_message TEXT NULL,
    delivered_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (appointment_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_appointment_provider_template_deliveries_appointment
    ON appointment_provider_template_deliveries(appointment_id, delivery_status);

CREATE INDEX IF NOT EXISTS idx_appointment_provider_template_deliveries_template
    ON appointment_provider_template_deliveries(template_id, delivery_status);
