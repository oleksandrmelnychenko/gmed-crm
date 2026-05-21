ALTER TABLE providers
    ADD COLUMN IF NOT EXISTS internal_rating DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS internal_rating_note TEXT,
    ADD COLUMN IF NOT EXISTS taxonomy_attributes JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'providers_internal_rating_range'
    ) THEN
        ALTER TABLE providers
            ADD CONSTRAINT providers_internal_rating_range
            CHECK (internal_rating IS NULL OR (internal_rating >= 0 AND internal_rating <= 5));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'providers_internal_rating_note_length'
    ) THEN
        ALTER TABLE providers
            ADD CONSTRAINT providers_internal_rating_note_length
            CHECK (internal_rating_note IS NULL OR length(internal_rating_note) <= 2000);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'providers_taxonomy_attributes_object'
    ) THEN
        ALTER TABLE providers
            ADD CONSTRAINT providers_taxonomy_attributes_object
            CHECK (jsonb_typeof(taxonomy_attributes) = 'object');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS provider_taxonomy_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    parent_id UUID REFERENCES provider_taxonomy_nodes(id) ON DELETE CASCADE,
    level TEXT NOT NULL CHECK (level IN ('category', 'group', 'subgroup', 'type')),
    provider_kind TEXT NOT NULL CHECK (provider_kind IN ('medical', 'non_medical')),
    name_de TEXT NOT NULL,
    name_ru TEXT,
    description TEXT,
    filter_keys TEXT[] NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 1000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (length(btrim(code)) > 0),
    CHECK (length(btrim(name_de)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_provider_taxonomy_nodes_parent_id
    ON provider_taxonomy_nodes(parent_id);

CREATE INDEX IF NOT EXISTS idx_provider_taxonomy_nodes_kind_level
    ON provider_taxonomy_nodes(provider_kind, level, is_active, sort_order);

CREATE INDEX IF NOT EXISTS idx_provider_taxonomy_nodes_active_code
    ON provider_taxonomy_nodes(is_active, code);

DROP TRIGGER IF EXISTS set_updated_at_provider_taxonomy_nodes ON provider_taxonomy_nodes;
CREATE TRIGGER set_updated_at_provider_taxonomy_nodes
    BEFORE UPDATE ON provider_taxonomy_nodes
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS provider_taxonomy_assignments (
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    taxonomy_node_id UUID NOT NULL REFERENCES provider_taxonomy_nodes(id) ON DELETE RESTRICT,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider_id, taxonomy_node_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_taxonomy_assignments_primary
    ON provider_taxonomy_assignments(provider_id)
    WHERE is_primary;

CREATE INDEX IF NOT EXISTS idx_provider_taxonomy_assignments_node_id
    ON provider_taxonomy_assignments(taxonomy_node_id);

WITH seed(code, parent_code, level, provider_kind, name_de, name_ru, sort_order, filter_keys) AS (
    VALUES
        ('medical_providers', NULL, 'category', 'medical', 'Medizinische Provider', 'Медицинские провайдеры', 10, ARRAY['city','country','internal_rating','linked_patient']),
        ('nonmedical_providers', NULL, 'category', 'non_medical', 'Nicht-Medizinische Provider', 'Немедицинские провайдеры', 20, ARRAY['city','country','internal_rating','linked_patient']),

        ('medical_clinics_practices', 'medical_providers', 'group', 'medical', 'Kliniken & Praxen', 'Клиники и практики', 110, ARRAY['fachbereich','specializations','city','country','has_contract','internal_rating']),
        ('medical_pharmacies_supply', 'medical_providers', 'group', 'medical', 'Apotheken/Sanitaetshaeuser', 'Аптеки и медтехника', 120, ARRAY['city','country','has_contract','internal_rating']),
        ('medical_reha_care', 'medical_providers', 'group', 'medical', 'Reha & Pflege', 'Реабилитация и уход', 130, ARRAY['city','country','has_contract','internal_rating']),
        ('medical_therapeutic', 'medical_providers', 'group', 'medical', 'Therapeutische Provider', 'Терапевтические провайдеры', 140, ARRAY['fachbereich','specializations','city','country','has_contract','internal_rating']),

        ('nonmedical_transport_logistics', 'nonmedical_providers', 'group', 'non_medical', 'Transport & Logistics', 'Транспорт и логистика', 210, ARRAY['city','country','vehicle_class','has_contract','internal_rating']),
        ('nonmedical_lodging_travel', 'nonmedical_providers', 'group', 'non_medical', 'Unterkunft & Reisen', 'Проживание и поездки', 220, ARRAY['city','country','stars','has_contract','internal_rating']),
        ('nonmedical_gastronomy_nutrition', 'nonmedical_providers', 'group', 'non_medical', 'Gastronomie & Ernaehrung', 'Гастрономия и питание', 230, ARRAY['city','country','cuisine','has_contract','internal_rating']),
        ('nonmedical_wellness_freizeit', 'nonmedical_providers', 'group', 'non_medical', 'Wellness & Freizeit', 'Wellness и досуг', 240, ARRAY['city','country','has_contract','internal_rating']),
        ('nonmedical_admin_legal', 'nonmedical_providers', 'group', 'non_medical', 'Amt/Recht/Verwaltung', 'Администрация и право', 250, ARRAY['city','country','language','has_contract','internal_rating']),

        ('nonmedical_ground_transport', 'nonmedical_transport_logistics', 'subgroup', 'non_medical', 'Boden Transport', 'Наземный транспорт', 211, ARRAY['city','country','vehicle_class','passenger_capacity','medical_equipment','has_contract','internal_rating']),
        ('nonmedical_aviation', 'nonmedical_transport_logistics', 'subgroup', 'non_medical', 'Aviation & Airport', 'Авиация и аэропорт', 212, ARRAY['city','country','airport','aircraft_type','medical_equipment','has_contract','internal_rating']),

        ('medical_clinics_practices_specialized_centers', 'medical_clinics_practices', 'type', 'medical', 'Kliniken, Praxen, Fachzentren', 'Клиники, практики, профильные центры', 111, ARRAY['fachbereich','specializations','doctor_name','doctor_fachbereich','service_name','city','country','has_contract','internal_rating','linked_patient']),
        ('medical_pharmacies', 'medical_pharmacies_supply', 'type', 'medical', 'Apotheken', 'Аптеки', 121, ARRAY['city','country','has_contract','internal_rating','linked_patient']),
        ('medical_medical_supply_stores', 'medical_pharmacies_supply', 'type', 'medical', 'Sanitaetshaeuser', 'Медицинская техника', 122, ARRAY['city','country','has_contract','internal_rating','linked_patient']),
        ('medical_reha_clinics', 'medical_reha_care', 'type', 'medical', 'Reha-Kliniken', 'Реабилитационные клиники', 131, ARRAY['fachbereich','specializations','city','country','has_contract','internal_rating','linked_patient']),
        ('medical_care_facilities', 'medical_reha_care', 'type', 'medical', 'Pflegeeinrichtungen', 'Учреждения ухода', 132, ARRAY['city','country','has_contract','internal_rating','linked_patient']),
        ('medical_palliative', 'medical_reha_care', 'type', 'medical', 'Palliativ', 'Паллиативная помощь', 133, ARRAY['city','country','has_contract','internal_rating','linked_patient']),
        ('medical_physiotherapy', 'medical_therapeutic', 'type', 'medical', 'Physiotherapie', 'Физиотерапия', 141, ARRAY['fachbereich','specializations','city','country','has_contract','internal_rating','linked_patient']),
        ('medical_ergotherapy_logopedics', 'medical_therapeutic', 'type', 'medical', 'Ergotherapie/Logopaedie', 'Эрготерапия/логопедия', 142, ARRAY['fachbereich','specializations','city','country','has_contract','internal_rating','linked_patient']),
        ('medical_psychotherapy', 'medical_therapeutic', 'type', 'medical', 'Psychotherapie', 'Психотерапия', 143, ARRAY['fachbereich','specializations','city','country','has_contract','internal_rating','linked_patient']),
        ('medical_other_health_professions', 'medical_therapeutic', 'type', 'medical', 'Sonstige Heilberufe', 'Другие медицинские профессии', 144, ARRAY['fachbereich','specializations','city','country','has_contract','internal_rating','linked_patient']),

        ('nonmedical_chauffeur', 'nonmedical_ground_transport', 'type', 'non_medical', 'Chauffeur / Limousine', 'Шофер / лимузин', 213, ARRAY['city','country','vehicle_class','passenger_capacity','has_contract','internal_rating','linked_patient']),
        ('nonmedical_car_rental', 'nonmedical_ground_transport', 'type', 'non_medical', 'Autovermietung', 'Аренда авто', 214, ARRAY['city','country','vehicle_class','has_contract','internal_rating','linked_patient']),
        ('nonmedical_medical_ground_transport', 'nonmedical_ground_transport', 'type', 'non_medical', 'Medizinischer Bodentransport', 'Медицинский наземный транспорт', 215, ARRAY['city','country','vehicle_class','medical_equipment','has_contract','internal_rating','linked_patient']),
        ('nonmedical_business_aviation', 'nonmedical_aviation', 'type', 'non_medical', 'Business Aviation', 'Бизнес-авиация', 216, ARRAY['city','country','airport','aircraft_type','has_contract','internal_rating','linked_patient']),
        ('nonmedical_medevac', 'nonmedical_aviation', 'type', 'non_medical', 'MedEvac', 'Медицинская авиаэвакуация', 217, ARRAY['city','country','airport','aircraft_type','medical_equipment','has_contract','internal_rating','linked_patient']),
        ('nonmedical_airports', 'nonmedical_aviation', 'type', 'non_medical', 'Airport / VIP Terminal', 'Аэропорт / VIP-терминал', 218, ARRAY['city','country','airport','has_contract','internal_rating','linked_patient']),

        ('nonmedical_hotels', 'nonmedical_lodging_travel', 'type', 'non_medical', 'Hotels', 'Отели', 221, ARRAY['city','country','stars','room_type','has_contract','internal_rating','linked_patient']),
        ('nonmedical_private_accommodation', 'nonmedical_lodging_travel', 'type', 'non_medical', 'Apartments / Private Unterkunft', 'Апартаменты / частное жилье', 222, ARRAY['city','country','room_type','has_contract','internal_rating','linked_patient']),

        ('nonmedical_restaurants', 'nonmedical_gastronomy_nutrition', 'type', 'non_medical', 'Restaurants', 'Рестораны', 231, ARRAY['city','country','cuisine','diet','has_contract','internal_rating','linked_patient']),
        ('nonmedical_bars', 'nonmedical_gastronomy_nutrition', 'type', 'non_medical', 'Bars', 'Бары', 232, ARRAY['city','country','cuisine','has_contract','internal_rating','linked_patient']),
        ('nonmedical_catering', 'nonmedical_gastronomy_nutrition', 'type', 'non_medical', 'Catering', 'Кейтеринг', 233, ARRAY['city','country','cuisine','diet','has_contract','internal_rating','linked_patient']),
        ('nonmedical_private_cook', 'nonmedical_gastronomy_nutrition', 'type', 'non_medical', 'Private Kochservice', 'Персональный повар', 234, ARRAY['city','country','cuisine','diet','has_contract','internal_rating','linked_patient']),

        ('nonmedical_nightclubs', 'nonmedical_wellness_freizeit', 'type', 'non_medical', 'Nightclubs', 'Ночные клубы', 241, ARRAY['city','country','has_contract','internal_rating','linked_patient']),
        ('nonmedical_culture', 'nonmedical_wellness_freizeit', 'type', 'non_medical', 'Kultur Provider', 'Культурные провайдеры', 242, ARRAY['city','country','has_contract','internal_rating','linked_patient']),
        ('nonmedical_spa_wellness', 'nonmedical_wellness_freizeit', 'type', 'non_medical', 'Spa & Wellness', 'Spa и wellness', 243, ARRAY['city','country','has_contract','internal_rating','linked_patient']),
        ('nonmedical_sport', 'nonmedical_wellness_freizeit', 'type', 'non_medical', 'Sport', 'Спорт', 244, ARRAY['city','country','has_contract','internal_rating','linked_patient']),
        ('nonmedical_adult_entertainment', 'nonmedical_wellness_freizeit', 'type', 'non_medical', 'Adult Entertainment', 'Развлечения 18+', 245, ARRAY['city','country','has_contract','internal_rating','linked_patient']),
        ('nonmedical_other', 'nonmedical_wellness_freizeit', 'type', 'non_medical', 'Sonstige Freizeit Provider', 'Другие провайдеры досуга', 246, ARRAY['city','country','has_contract','internal_rating','linked_patient']),

        ('nonmedical_government_offices', 'nonmedical_admin_legal', 'type', 'non_medical', 'Aemter / Verwaltung', 'Госорганы / администрация', 251, ARRAY['city','country','language','has_contract','internal_rating','linked_patient']),
        ('nonmedical_legal', 'nonmedical_admin_legal', 'type', 'non_medical', 'Anwaelte / Kanzleien', 'Юристы / юридические фирмы', 252, ARRAY['city','country','language','has_contract','internal_rating','linked_patient'])
)
INSERT INTO provider_taxonomy_nodes (
    code, level, provider_kind, name_de, name_ru, sort_order, filter_keys
)
SELECT code, level, provider_kind, name_de, name_ru, sort_order, filter_keys
FROM seed
ON CONFLICT (code) DO UPDATE
SET level = EXCLUDED.level,
    provider_kind = EXCLUDED.provider_kind,
    name_de = EXCLUDED.name_de,
    name_ru = EXCLUDED.name_ru,
    sort_order = EXCLUDED.sort_order,
    filter_keys = EXCLUDED.filter_keys,
    is_active = TRUE;

WITH seed(code, parent_code) AS (
    VALUES
        ('medical_providers', NULL),
        ('nonmedical_providers', NULL),
        ('medical_clinics_practices', 'medical_providers'),
        ('medical_pharmacies_supply', 'medical_providers'),
        ('medical_reha_care', 'medical_providers'),
        ('medical_therapeutic', 'medical_providers'),
        ('nonmedical_transport_logistics', 'nonmedical_providers'),
        ('nonmedical_lodging_travel', 'nonmedical_providers'),
        ('nonmedical_gastronomy_nutrition', 'nonmedical_providers'),
        ('nonmedical_wellness_freizeit', 'nonmedical_providers'),
        ('nonmedical_admin_legal', 'nonmedical_providers'),
        ('nonmedical_ground_transport', 'nonmedical_transport_logistics'),
        ('nonmedical_aviation', 'nonmedical_transport_logistics'),
        ('medical_clinics_practices_specialized_centers', 'medical_clinics_practices'),
        ('medical_pharmacies', 'medical_pharmacies_supply'),
        ('medical_medical_supply_stores', 'medical_pharmacies_supply'),
        ('medical_reha_clinics', 'medical_reha_care'),
        ('medical_care_facilities', 'medical_reha_care'),
        ('medical_palliative', 'medical_reha_care'),
        ('medical_physiotherapy', 'medical_therapeutic'),
        ('medical_ergotherapy_logopedics', 'medical_therapeutic'),
        ('medical_psychotherapy', 'medical_therapeutic'),
        ('medical_other_health_professions', 'medical_therapeutic'),
        ('nonmedical_chauffeur', 'nonmedical_ground_transport'),
        ('nonmedical_car_rental', 'nonmedical_ground_transport'),
        ('nonmedical_medical_ground_transport', 'nonmedical_ground_transport'),
        ('nonmedical_business_aviation', 'nonmedical_aviation'),
        ('nonmedical_medevac', 'nonmedical_aviation'),
        ('nonmedical_airports', 'nonmedical_aviation'),
        ('nonmedical_hotels', 'nonmedical_lodging_travel'),
        ('nonmedical_private_accommodation', 'nonmedical_lodging_travel'),
        ('nonmedical_restaurants', 'nonmedical_gastronomy_nutrition'),
        ('nonmedical_bars', 'nonmedical_gastronomy_nutrition'),
        ('nonmedical_catering', 'nonmedical_gastronomy_nutrition'),
        ('nonmedical_private_cook', 'nonmedical_gastronomy_nutrition'),
        ('nonmedical_nightclubs', 'nonmedical_wellness_freizeit'),
        ('nonmedical_culture', 'nonmedical_wellness_freizeit'),
        ('nonmedical_spa_wellness', 'nonmedical_wellness_freizeit'),
        ('nonmedical_sport', 'nonmedical_wellness_freizeit'),
        ('nonmedical_adult_entertainment', 'nonmedical_wellness_freizeit'),
        ('nonmedical_other', 'nonmedical_wellness_freizeit'),
        ('nonmedical_government_offices', 'nonmedical_admin_legal'),
        ('nonmedical_legal', 'nonmedical_admin_legal')
)
UPDATE provider_taxonomy_nodes child
SET parent_id = parent.id
FROM seed
LEFT JOIN provider_taxonomy_nodes parent ON parent.code = seed.parent_code
WHERE child.code = seed.code
  AND child.parent_id IS DISTINCT FROM parent.id;

INSERT INTO provider_taxonomy_assignments (provider_id, taxonomy_node_id, is_primary)
SELECT p.id,
       n.id,
       TRUE
FROM providers p
JOIN provider_taxonomy_nodes n
  ON n.code = CASE
        WHEN p.provider_type = 'medical' THEN 'medical_clinics_practices_specialized_centers'
        ELSE 'nonmedical_other'
     END
WHERE NOT EXISTS (
    SELECT 1
    FROM provider_taxonomy_assignments existing
    WHERE existing.provider_id = p.id
);

ALTER TABLE concierge_services
    ADD COLUMN IF NOT EXISTS taxonomy_node_id UUID REFERENCES provider_taxonomy_nodes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_concierge_services_taxonomy_node_id
    ON concierge_services(taxonomy_node_id);

ALTER TABLE service_catalog
    ADD COLUMN IF NOT EXISTS taxonomy_node_id UUID REFERENCES provider_taxonomy_nodes(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS taxonomy_attributes JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_service_catalog_taxonomy_node_id
    ON service_catalog(taxonomy_node_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'service_catalog_taxonomy_attributes_object'
    ) THEN
        ALTER TABLE service_catalog
            ADD CONSTRAINT service_catalog_taxonomy_attributes_object
            CHECK (jsonb_typeof(taxonomy_attributes) = 'object');
    END IF;
END $$;

UPDATE service_catalog s
SET taxonomy_node_id = pta.taxonomy_node_id
FROM providers p
JOIN provider_taxonomy_assignments pta
  ON pta.provider_id = p.id
 AND pta.is_primary = TRUE
JOIN provider_taxonomy_nodes n
  ON n.id = pta.taxonomy_node_id
 AND n.provider_kind = p.provider_type
 AND n.level = 'type'
WHERE s.provider_id = p.id
  AND s.taxonomy_node_id IS NULL;

UPDATE concierge_services cs
SET taxonomy_node_id = pta.taxonomy_node_id
FROM providers p
JOIN provider_taxonomy_assignments pta
  ON pta.provider_id = p.id
 AND pta.is_primary = TRUE
JOIN provider_taxonomy_nodes n
  ON n.id = pta.taxonomy_node_id
 AND n.provider_kind = 'non_medical'
 AND n.level = 'type'
WHERE cs.provider_id = p.id
  AND cs.taxonomy_node_id IS NULL
  AND p.provider_type = 'non_medical';
