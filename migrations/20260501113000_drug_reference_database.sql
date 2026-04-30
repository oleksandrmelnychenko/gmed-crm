CREATE TABLE IF NOT EXISTS drug_substances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS drug_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_name TEXT NOT NULL,
    normalized_brand_name TEXT NOT NULL,
    country_code TEXT NOT NULL DEFAULT 'DE',
    atc_code TEXT,
    form TEXT,
    strength TEXT,
    manufacturer TEXT,
    verification_status TEXT NOT NULL DEFAULT 'curated'
        CHECK (verification_status IN ('curated', 'candidate', 'verified', 'rejected')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    source_kind TEXT NOT NULL DEFAULT 'manual_curated'
        CHECK (source_kind IN ('manual_curated', 'manual_candidate')),
    clinical_note TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_drug_products_unique_manual
    ON drug_products(
        normalized_brand_name,
        country_code,
        COALESCE(strength, ''),
        COALESCE(form, '')
    )
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_drug_products_search
    ON drug_products(normalized_brand_name, country_code)
    WHERE is_active = true;

CREATE TRIGGER set_updated_at_drug_products
    BEFORE UPDATE ON drug_products
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS drug_product_substances (
    product_id UUID NOT NULL REFERENCES drug_products(id) ON DELETE CASCADE,
    substance_id UUID NOT NULL REFERENCES drug_substances(id) ON DELETE CASCADE,
    strength_text TEXT,
    PRIMARY KEY (product_id, substance_id)
);

CREATE INDEX IF NOT EXISTS idx_drug_product_substances_substance
    ON drug_product_substances(substance_id);

CREATE TABLE IF NOT EXISTS drug_equivalents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_product_id UUID NOT NULL REFERENCES drug_products(id) ON DELETE CASCADE,
    equivalent_product_id UUID NOT NULL REFERENCES drug_products(id) ON DELETE CASCADE,
    confidence NUMERIC NOT NULL DEFAULT 0.80,
    verification_status TEXT NOT NULL DEFAULT 'candidate'
        CHECK (verification_status IN ('candidate', 'verified', 'rejected')),
    note TEXT,
    verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_product_id, equivalent_product_id)
);

CREATE INDEX IF NOT EXISTS idx_drug_equivalents_source
    ON drug_equivalents(source_product_id, verification_status);

CREATE INDEX IF NOT EXISTS idx_drug_equivalents_equivalent
    ON drug_equivalents(equivalent_product_id, verification_status);

CREATE TRIGGER set_updated_at_drug_equivalents
    BEFORE UPDATE ON drug_equivalents
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS medication_drug_matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    medication_id UUID NOT NULL REFERENCES medikamente(id) ON DELETE CASCADE,
    drug_product_id UUID NOT NULL REFERENCES drug_products(id) ON DELETE RESTRICT,
    match_kind TEXT NOT NULL DEFAULT 'staff_candidate'
        CHECK (match_kind IN ('auto_candidate', 'staff_candidate', 'staff_verified')),
    confidence NUMERIC NOT NULL DEFAULT 0.70,
    verification_status TEXT NOT NULL DEFAULT 'candidate'
        CHECK (verification_status IN ('candidate', 'verified', 'rejected')),
    note TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (case_id, medication_id, drug_product_id)
);

CREATE INDEX IF NOT EXISTS idx_medication_drug_matches_case_medication
    ON medication_drug_matches(case_id, medication_id, verification_status);

CREATE TRIGGER set_updated_at_medication_drug_matches
    BEFORE UPDATE ON medication_drug_matches
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

INSERT INTO drug_substances (name, normalized_name)
VALUES
    ('Atorvastatin', 'atorvastatin'),
    ('Ibuprofen', 'ibuprofen'),
    ('Metformin', 'metformin')
ON CONFLICT (normalized_name) DO NOTHING;

INSERT INTO drug_products (
    brand_name, normalized_brand_name, country_code, atc_code, form, strength,
    manufacturer, verification_status, source_kind, clinical_note
)
VALUES
    ('Atoris', 'atoris', 'UA', 'C10AA05', 'tablet', '20 mg', 'KRKA', 'curated', 'manual_curated', 'Curated MVP seed; verify exact pack before clinical use.'),
    ('Sortis', 'sortis', 'DE', 'C10AA05', 'tablet', '20 mg', 'Pfizer', 'verified', 'manual_curated', 'German reference product; staff information only, not prescription.'),
    ('Nurofen', 'nurofen', 'UA', 'M01AE01', 'tablet', '200 mg', 'Reckitt', 'curated', 'manual_curated', 'Curated MVP seed; verify contraindications separately.'),
    ('Ibuprofen-ratiopharm', 'ibuprofen-ratiopharm', 'DE', 'M01AE01', 'tablet', '200 mg', 'ratiopharm', 'verified', 'manual_curated', 'German reference product; staff information only, not prescription.'),
    ('Siofor', 'siofor', 'UA', 'A10BA02', 'tablet', '500 mg', 'Berlin-Chemie', 'curated', 'manual_curated', 'Curated MVP seed; verify exact pack before clinical use.'),
    ('Metformin HEXAL', 'metformin hexal', 'DE', 'A10BA02', 'tablet', '500 mg', 'HEXAL', 'verified', 'manual_curated', 'German reference product; staff information only, not prescription.')
ON CONFLICT DO NOTHING;

INSERT INTO drug_product_substances (product_id, substance_id, strength_text)
SELECT p.id, s.id, p.strength
FROM drug_products p
JOIN drug_substances s ON s.normalized_name = 'atorvastatin'
WHERE p.normalized_brand_name IN ('atoris', 'sortis')
ON CONFLICT DO NOTHING;

INSERT INTO drug_product_substances (product_id, substance_id, strength_text)
SELECT p.id, s.id, p.strength
FROM drug_products p
JOIN drug_substances s ON s.normalized_name = 'ibuprofen'
WHERE p.normalized_brand_name IN ('nurofen', 'ibuprofen-ratiopharm')
ON CONFLICT DO NOTHING;

INSERT INTO drug_product_substances (product_id, substance_id, strength_text)
SELECT p.id, s.id, p.strength
FROM drug_products p
JOIN drug_substances s ON s.normalized_name = 'metformin'
WHERE p.normalized_brand_name IN ('siofor', 'metformin hexal')
ON CONFLICT DO NOTHING;

INSERT INTO drug_equivalents (
    source_product_id, equivalent_product_id, confidence, verification_status, note
)
SELECT source.id, equivalent.id, 0.92, 'verified',
       'Same active substance reference. Staff information only; not a prescription.'
FROM drug_products source
JOIN drug_products equivalent ON equivalent.normalized_brand_name = 'sortis'
WHERE source.normalized_brand_name = 'atoris'
ON CONFLICT DO NOTHING;

INSERT INTO drug_equivalents (
    source_product_id, equivalent_product_id, confidence, verification_status, note
)
SELECT source.id, equivalent.id, 0.90, 'verified',
       'Same active substance reference. Staff information only; not a prescription.'
FROM drug_products source
JOIN drug_products equivalent ON equivalent.normalized_brand_name = 'ibuprofen-ratiopharm'
WHERE source.normalized_brand_name = 'nurofen'
ON CONFLICT DO NOTHING;

INSERT INTO drug_equivalents (
    source_product_id, equivalent_product_id, confidence, verification_status, note
)
SELECT source.id, equivalent.id, 0.90, 'verified',
       'Same active substance reference. Staff information only; not a prescription.'
FROM drug_products source
JOIN drug_products equivalent ON equivalent.normalized_brand_name = 'metformin hexal'
WHERE source.normalized_brand_name = 'siofor'
ON CONFLICT DO NOTHING;
