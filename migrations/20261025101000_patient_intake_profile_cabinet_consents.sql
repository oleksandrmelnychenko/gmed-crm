-- The patient card's block "Данные первичного обращения" reads the consents
-- from patients.intake_profile, which the conversion filled from the wizard
-- toggles only (staff's record of a paper consent). A consent given in the
-- lead cabinet (consent_records of the lead: lead_inquiry_processing,
-- health_data_processing) counted for the readiness but showed as "Нет" on
-- the card (QA 2026-10-25). The conversion now writes both sources; this
-- backfills the cards converted before. Same rule as the readiness: an
-- active record of the adult lead or of a parent / guardian (access_kind =
-- guardian); a minor's own login never counts.
WITH cabinet AS (
    SELECT p.id AS patient_id,
           EXISTS (
               SELECT 1 FROM consent_records cr
               WHERE cr.lead_id = l.id
                 AND cr.consent_type = 'lead_inquiry_processing'
                 AND cr.granted AND cr.revoked_at IS NULL
                 AND (cr.context->>'access_kind' = 'guardian'
                      OR l.date_of_birth IS NULL
                      OR l.date_of_birth
                         <= ((now() AT TIME ZONE 'Europe/Berlin')::date - INTERVAL '18 years'))
           ) AS privacy,
           EXISTS (
               SELECT 1 FROM consent_records cr
               WHERE cr.lead_id = l.id
                 AND cr.consent_type = 'health_data_processing'
                 AND cr.granted AND cr.revoked_at IS NULL
                 AND (cr.context->>'access_kind' = 'guardian'
                      OR l.date_of_birth IS NULL
                      OR l.date_of_birth
                         <= ((now() AT TIME ZONE 'Europe/Berlin')::date - INTERVAL '18 years'))
           ) AS healthcare
    FROM patients p
    JOIN leads l ON l.id = p.source_lead_id AND l.converted_patient_id = p.id
    WHERE jsonb_typeof(p.intake_profile) = 'object'
)
UPDATE patients p
SET intake_profile = p.intake_profile
    || CASE WHEN cabinet.privacy THEN '{"consent_privacy_practices": true}'::jsonb ELSE '{}'::jsonb END
    || CASE WHEN cabinet.healthcare THEN '{"consent_healthcare": true}'::jsonb ELSE '{}'::jsonb END,
    updated_at = now()
FROM cabinet
WHERE cabinet.patient_id = p.id
  AND (
      (cabinet.privacy AND p.intake_profile->'consent_privacy_practices' IS DISTINCT FROM 'true'::jsonb)
      OR (cabinet.healthcare AND p.intake_profile->'consent_healthcare' IS DISTINCT FROM 'true'::jsonb)
  );
