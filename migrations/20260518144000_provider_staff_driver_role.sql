-- Add a user-selectable staff role for non-medical drivers/chauffeurs.

INSERT INTO provider_staff_roles (code, name_en, name_de, name_ru, sort_order)
VALUES ('driver', 'Driver', 'Fahrer', 'Водитель', 90)
ON CONFLICT (code) DO UPDATE
SET name_en = EXCLUDED.name_en,
    name_de = EXCLUDED.name_de,
    name_ru = EXCLUDED.name_ru,
    sort_order = EXCLUDED.sort_order,
    updated_at = now();
