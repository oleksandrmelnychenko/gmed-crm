WITH updates(code, filter_keys, description) AS (
    VALUES
        (
            'nonmedical_transport_logistics',
            ARRAY['city','country','vehicle_class','passenger_capacity','medical_equipment','airport','aircraft_type','government_affiliation','has_contract','internal_rating','linked_patient']::text[],
            NULL::text
        ),
        (
            'nonmedical_ground_transport',
            ARRAY['city','country','vehicle_class','passenger_capacity','medical_equipment','has_contract','internal_rating','linked_patient']::text[],
            NULL::text
        ),
        (
            'nonmedical_aviation',
            ARRAY['city','country','airport','aircraft_type','medical_equipment','government_affiliation','has_contract','internal_rating','linked_patient']::text[],
            NULL::text
        ),
        (
            'nonmedical_lodging_travel',
            ARRAY['city','country','stars','room_type','has_contract','internal_rating','linked_patient']::text[],
            NULL::text
        ),
        (
            'nonmedical_gastronomy_nutrition',
            ARRAY['city','country','michelin_stars','cuisine','diet','has_contract','internal_rating','linked_patient']::text[],
            NULL::text
        ),
        (
            'nonmedical_wellness_freizeit',
            ARRAY['city','country','music_direction','sport_type','has_contract','internal_rating','linked_patient']::text[],
            NULL::text
        ),
        (
            'nonmedical_admin_legal',
            ARRAY['city','country','government_affiliation','administrative_specialization','legal_area','language','has_contract','internal_rating','linked_patient']::text[],
            NULL::text
        ),
        (
            'nonmedical_airports',
            ARRAY['city','country','airport','government_affiliation','has_contract','internal_rating','linked_patient']::text[],
            NULL::text
        ),
        (
            'nonmedical_hotels',
            ARRAY['city','country','stars','room_type','has_contract','internal_rating','linked_patient']::text[],
            NULL::text
        ),
        (
            'nonmedical_restaurants',
            ARRAY['city','country','michelin_stars','cuisine','diet','has_contract','internal_rating','linked_patient']::text[],
            NULL::text
        ),
        (
            'nonmedical_bars',
            ARRAY['city','country','michelin_stars','cuisine','has_contract','internal_rating','linked_patient']::text[],
            NULL::text
        ),
        (
            'nonmedical_nightclubs',
            ARRAY['city','country','music_direction','has_contract','internal_rating','linked_patient']::text[],
            NULL::text
        ),
        (
            'nonmedical_sport',
            ARRAY['city','country','sport_type','has_contract','internal_rating','linked_patient']::text[],
            NULL::text
        ),
        (
            'nonmedical_government_offices',
            ARRAY['city','country','government_affiliation','administrative_specialization','language','has_contract','internal_rating','linked_patient']::text[],
            'Городские управы и их отделы, включая миграционный офис, посольства, таможню и связанные административные учреждения.'
        ),
        (
            'nonmedical_legal',
            ARRAY['city','country','legal_area','language','has_contract','internal_rating','linked_patient']::text[],
            NULL::text
        )
)
UPDATE provider_taxonomy_nodes node
SET filter_keys = updates.filter_keys,
    description = COALESCE(updates.description, node.description),
    updated_at = now()
FROM updates
WHERE node.code = updates.code
  AND (
      node.filter_keys IS DISTINCT FROM updates.filter_keys
      OR (updates.description IS NOT NULL AND node.description IS DISTINCT FROM updates.description)
  );
