-- Price-ranged work types and multilingual description blocks for the existing
-- medical specialization catalog.

CREATE TABLE medical_specialization_work_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    specialization_id UUID NOT NULL
        REFERENCES medical_specializations(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name_de TEXT NOT NULL,
    name_ru TEXT NOT NULL,
    min_price_eur NUMERIC(12, 2) NOT NULL,
    max_price_eur NUMERIC(12, 2) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 1000,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT medical_specialization_work_types_code_not_blank
        CHECK (btrim(code) <> ''),
    CONSTRAINT medical_specialization_work_types_name_de_not_blank
        CHECK (btrim(name_de) <> ''),
    CONSTRAINT medical_specialization_work_types_name_ru_not_blank
        CHECK (btrim(name_ru) <> ''),
    CONSTRAINT medical_specialization_work_types_min_price_check
        CHECK (min_price_eur >= 0),
    CONSTRAINT medical_specialization_work_types_max_price_check
        CHECK (max_price_eur >= min_price_eur)
);

CREATE UNIQUE INDEX uq_medical_specialization_work_types_code
    ON medical_specialization_work_types(specialization_id, code)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_medical_specialization_work_types_list
    ON medical_specialization_work_types(
        specialization_id,
        is_active DESC,
        sort_order,
        name_de
    )
    WHERE deleted_at IS NULL;

CREATE TRIGGER set_updated_at_medical_specialization_work_types
    BEFORE UPDATE ON medical_specialization_work_types
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE medical_specialization_work_type_descriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_type_id UUID NOT NULL
        REFERENCES medical_specialization_work_types(id) ON DELETE CASCADE,
    language_code TEXT NOT NULL,
    body TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 1000,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT medical_specialization_work_type_descriptions_language_not_blank
        CHECK (btrim(language_code) <> ''),
    CONSTRAINT medical_specialization_work_type_descriptions_body_not_blank
        CHECK (btrim(body) <> '')
);

CREATE INDEX idx_medical_specialization_work_type_descriptions_list
    ON medical_specialization_work_type_descriptions(
        work_type_id,
        is_active DESC,
        sort_order,
        language_code
    )
    WHERE deleted_at IS NULL;

CREATE TRIGGER set_updated_at_medical_specialization_work_type_descriptions
    BEFORE UPDATE ON medical_specialization_work_type_descriptions
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
