-- Canonical legal-document contact profile. The address is contractual copy;
-- existing non-empty phone, email, and website values remain administrator-owned.
INSERT INTO system_settings (key, value, description)
VALUES (
    'agency_address',
    to_jsonb(E'Albert-Schweitzer-Straße 56\n81735 München'::text),
    'Agency address used in generated legal documents and print blocks'
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    description = EXCLUDED.description,
    updated_at = now();

INSERT INTO system_settings (key, value, description)
VALUES
    (
        'agency_phone',
        to_jsonb('+49 176 22570962'::text),
        'Agency phone used in generated legal documents and print blocks'
    ),
    (
        'agency_email',
        to_jsonb('office@gmed-health.com'::text),
        'Agency email used in generated legal documents and print blocks'
    ),
    (
        'agency_website',
        to_jsonb('gmed-health.com'::text),
        'Agency website used in generated legal document footers'
    )
ON CONFLICT (key) DO UPDATE
SET value = CASE
        WHEN NULLIF(btrim(system_settings.value #>> '{}'), '') IS NULL
            THEN EXCLUDED.value
        ELSE system_settings.value
    END,
    description = EXCLUDED.description,
    updated_at = CASE
        WHEN NULLIF(btrim(system_settings.value #>> '{}'), '') IS NULL
            THEN now()
        ELSE system_settings.updated_at
    END;
