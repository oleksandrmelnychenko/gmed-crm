-- The staff lead wizard stores citizenship separately from the residence country.
-- Preserve that distinction when a patient was already created from the lead.
UPDATE patients AS patient
SET nationality = COALESCE(
        NULLIF(btrim(patient.nationality), ''),
        NULLIF(btrim(lead.wizard_state ->> 'registration_country'), '')
    ),
    passport_expiry = COALESCE(
        patient.passport_expiry,
        CASE
            WHEN (lead.wizard_state ->> 'passport_expiry') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                THEN (lead.wizard_state ->> 'passport_expiry')::date
            ELSE NULL
        END
    ),
    updated_at = now()
FROM leads AS lead
WHERE patient.source_lead_id = lead.id
  AND (
      (
          NULLIF(btrim(patient.nationality), '') IS NULL
          AND NULLIF(btrim(lead.wizard_state ->> 'registration_country'), '') IS NOT NULL
      )
      OR (
          patient.passport_expiry IS NULL
          AND (lead.wizard_state ->> 'passport_expiry') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      )
  );
