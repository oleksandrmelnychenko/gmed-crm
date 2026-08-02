-- Keep patient_clinical_versions append-only while allowing the explicit GDPR
-- cleanup performed immediately before an unconverted prospect is deleted.
--
-- The parent patient and its lead must still exist when the versions are
-- deleted. A later ON DELETE CASCADE cannot pass this guard after the parent is
-- gone, which makes the required operation ordering explicit and auditable.

CREATE OR REPLACE FUNCTION prevent_patient_clinical_version_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE'
       AND EXISTS (
           SELECT 1
           FROM patients p
           JOIN leads l ON l.prospect_patient_id = p.id
           WHERE p.id = OLD.patient_id
             AND p.lifecycle_status = 'prospective'
             AND NOT p.is_active
             AND l.converted_patient_id IS NULL
             AND l.qualification_status <> 'converted'
       )
       AND NOT EXISTS (
           SELECT 1
           FROM leads converted_lead
           WHERE converted_lead.converted_patient_id = OLD.patient_id
              OR (
                  converted_lead.prospect_patient_id = OLD.patient_id
                  AND converted_lead.qualification_status = 'converted'
              )
       ) THEN
        RETURN OLD;
    END IF;

    RAISE EXCEPTION
        'patient_clinical_versions is immutable; updates and deletes are forbidden';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION prevent_patient_clinical_version_mutation() IS
    'Rejects every update and delete except explicit version cleanup for an existing unconverted prospective patient.';
