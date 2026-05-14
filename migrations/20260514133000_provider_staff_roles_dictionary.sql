-- Administrable provider staff role dictionary.

CREATE TABLE IF NOT EXISTS provider_staff_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name_en TEXT NOT NULL,
    name_de TEXT,
    name_ru TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 1000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (length(btrim(code)) > 0),
    CHECK (length(btrim(name_en)) > 0)
);

DROP TRIGGER IF EXISTS set_updated_at_provider_staff_roles ON provider_staff_roles;
CREATE TRIGGER set_updated_at_provider_staff_roles
    BEFORE UPDATE ON provider_staff_roles
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

INSERT INTO provider_staff_roles (code, name_en, name_de, name_ru, sort_order)
VALUES
    ('staff', 'Staff', 'Mitarbeitender', 'Сотрудник', 10),
    ('secretary', 'Secretariat', 'Sekretariat', 'Секретариат', 20),
    ('coordinator', 'Coordinator', 'Koordination', 'Координатор', 30),
    ('assistant', 'Assistant', 'Assistenz', 'Ассистент', 40),
    ('reception', 'Reception', 'Empfang', 'Ресепшн', 50),
    ('administration', 'Administration', 'Verwaltung', 'Администрация', 60),
    ('billing', 'Billing', 'Abrechnung', 'Биллинг', 70),
    ('nurse', 'Nursing staff', 'Pflege', 'Медперсонал', 80),
    ('other', 'Other', 'Sonstiges', 'Другое', 900)
ON CONFLICT (code) DO UPDATE
SET name_en = EXCLUDED.name_en,
    name_de = EXCLUDED.name_de,
    name_ru = EXCLUDED.name_ru,
    sort_order = EXCLUDED.sort_order,
    updated_at = now();

WITH existing_roles AS (
    SELECT DISTINCT btrim(role) AS code
    FROM provider_staff
    WHERE NULLIF(btrim(role), '') IS NOT NULL
)
INSERT INTO provider_staff_roles (code, name_en, name_de, name_ru, sort_order)
SELECT
    code,
    initcap(replace(code, '_', ' ')),
    initcap(replace(code, '_', ' ')),
    initcap(replace(code, '_', ' ')),
    800
FROM existing_roles
ON CONFLICT (code) DO NOTHING;
