CREATE TABLE provider_templates (
    id UUID PRIMARY KEY,
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    doctor_id UUID NULL REFERENCES provider_doctors(id) ON DELETE SET NULL,
    label TEXT NOT NULL,
    description TEXT NULL,
    art TEXT NOT NULL DEFAULT 'provider_template_instruction',
    category TEXT NOT NULL DEFAULT 'provider_template',
    default_auto_name TEXT NOT NULL,
    default_status TEXT NOT NULL DEFAULT 'draft',
    default_visibility TEXT NOT NULL DEFAULT 'patient_visible',
    is_medical BOOLEAN NOT NULL DEFAULT TRUE,
    supported_languages TEXT[] NOT NULL DEFAULT ARRAY['de']::TEXT[],
    body_de TEXT NULL,
    body_en TEXT NULL,
    body_uk TEXT NULL,
    body_ru TEXT NULL,
    notes TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_provider_templates_provider_id ON provider_templates(provider_id);
CREATE INDEX idx_provider_templates_doctor_id ON provider_templates(doctor_id);
CREATE INDEX idx_provider_templates_active_provider ON provider_templates(provider_id, is_active);
