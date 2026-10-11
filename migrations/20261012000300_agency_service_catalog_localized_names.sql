-- Catalogue names per language (QA 2026-10-11 C-07, C-09, D-12).
--
-- The base `service_name` and `description` of an agency service are the
-- German texts that orders, cost estimates and invoices print. The Russian
-- staff UI shows `name_ru` / `description_ru` when they are set and falls
-- back to the base texts otherwise.
ALTER TABLE agency_service_catalog
    ADD COLUMN IF NOT EXISTS name_ru TEXT,
    ADD COLUMN IF NOT EXISTS description_ru TEXT;

ALTER TABLE agency_service_catalog
    DROP CONSTRAINT IF EXISTS agency_service_catalog_name_ru_length,
    ADD CONSTRAINT agency_service_catalog_name_ru_length
        CHECK (name_ru IS NULL OR char_length(name_ru) BETWEEN 1 AND 160),
    DROP CONSTRAINT IF EXISTS agency_service_catalog_description_ru_length,
    ADD CONSTRAINT agency_service_catalog_description_ru_length
        CHECK (description_ru IS NULL OR char_length(description_ru) BETWEEN 1 AND 4000);

-- The seeded catalogue still carried English demo texts, which reached German
-- documents ("Interpreter support" on an invoice). Only those exact demo texts
-- are replaced; a name or description the agency entered itself stays. Order
-- lines keep the wording they were created with (snapshots).
UPDATE agency_service_catalog AS catalog
SET service_name = seed.name_de
FROM (VALUES
    ('treatment_organization', 'Treatment organization', 'Organisation der Behandlung'),
    ('interpreter_hours', 'Interpreter support', 'Dolmetscherbetreuung'),
    ('airport_transfer', 'Airport transfer coordination', 'Flughafentransfer'),
    ('concierge_companion', 'Companion support', 'Concierge-Begleitung')
) AS seed(service_key, name_en, name_de)
WHERE catalog.service_key = seed.service_key
  AND btrim(catalog.service_name) = seed.name_en;

-- The description trigger rebuilds `description_items` from the new text.
UPDATE agency_service_catalog AS catalog
SET description = seed.description_de
FROM (VALUES
    ('treatment_organization', 'Agency coordination and treatment scheduling.',
     'Agenturkoordination und Behandlungsplanung.'),
    ('interpreter_hours', 'Medical interpretation billed per hour.',
     'Medizinische Verdolmetschung mit Abrechnung pro Stunde.'),
    ('airport_transfer', 'Airport pickup or hotel transfer handled by concierge.',
     'Abholung am Flughafen oder Hoteltransfer durch den Concierge-Service.'),
    ('concierge_companion', 'Additional family coordination and on-site support.',
     'Zusätzliche Familienkoordination und Begleitung vor Ort.')
) AS seed(service_key, description_en, description_de)
WHERE catalog.service_key = seed.service_key
  AND btrim(COALESCE(catalog.description, '')) = seed.description_en;

-- Russian UI names of the seeded catalogue keys; Russian descriptions only
-- where the description is (now) the seeded German text.
UPDATE agency_service_catalog AS catalog
SET name_ru = COALESCE(catalog.name_ru, seed.name_ru),
    description_ru = COALESCE(
        catalog.description_ru,
        CASE WHEN btrim(COALESCE(catalog.description, '')) = seed.description_de
             THEN seed.description_ru END
    )
FROM (VALUES
    ('treatment_organization', 'Организация лечения',
     'Agenturkoordination und Behandlungsplanung.',
     'Координация агентства и планирование лечения.'),
    ('interpreter_hours', 'Услуги переводчика',
     'Medizinische Verdolmetschung mit Abrechnung pro Stunde.',
     'Медицинский перевод с почасовой оплатой.'),
    ('airport_transfer', 'Трансфер из аэропорта',
     'Abholung am Flughafen oder Hoteltransfer durch den Concierge-Service.',
     'Встреча в аэропорту или трансфер в отель через консьерж-сервис.'),
    ('concierge_companion', 'Сопровождение консьержа',
     'Zusätzliche Familienkoordination und Begleitung vor Ort.',
     'Дополнительная координация семьи и сопровождение на месте.')
) AS seed(service_key, name_ru, description_de, description_ru)
WHERE catalog.service_key = seed.service_key;
