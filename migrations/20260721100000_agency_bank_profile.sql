-- Default payment profile for generated order documents. Existing administrator
-- values remain authoritative and are never overwritten by this migration.
INSERT INTO system_settings (key, value, description)
VALUES
    (
        'agency_bank_holder',
        to_jsonb('Heorhii Hudiiev'::text),
        'Bank account holder used in generated order documents'
    ),
    (
        'agency_bank_name',
        to_jsonb('Commerzbank München'::text),
        'Bank name used in generated order documents'
    ),
    (
        'agency_bank_swift',
        to_jsonb('COBADEFFXXX'::text),
        'Bank SWIFT/BIC used in generated order documents'
    ),
    (
        'agency_bank_iban',
        to_jsonb('DE71 7004 0045 0836 8961 00'::text),
        'Bank IBAN used in generated order documents'
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
