-- A parent's access to a converted child is not the parent's own patient record.
ALTER TABLE patient_assignments DROP CONSTRAINT patient_assignments_source_check;
ALTER TABLE patient_assignments ADD CONSTRAINT patient_assignments_source_check
    CHECK (source IN ('manual', 'interpreter_booking', 'lead_guardian'));

-- Repair only links proven by the original guardian grant and conversion.
-- An explicit own lead/login always takes precedence over guardian provenance.
WITH repaired AS (
    UPDATE patient_assignments pa SET source = 'lead_guardian'
    WHERE pa.source = 'manual'
      AND EXISTS (
          SELECT 1 FROM leads child JOIN lead_portal_access a ON a.lead_id = child.id
          WHERE child.converted_patient_id = pa.patient_id AND a.user_id = pa.user_id
            AND a.kind = 'guardian' AND a.revoked_at IS NULL
            AND child.portal_user_id IS DISTINCT FROM pa.user_id
      )
      AND NOT EXISTS (
          SELECT 1 FROM leads own WHERE own.converted_patient_id = pa.patient_id
            AND own.portal_user_id = pa.user_id
      )
    RETURNING patient_id, user_id
)
INSERT INTO audit_log (action, entity_type, entity_id, context)
SELECT 'mark_guardian_patient_access', 'patient', patient_id,
       jsonb_build_object('user_id', user_id, 'source', 'lead_guardian',
           'repair', '20261014183000_parent_portal_assignment_provenance')
FROM repaired;

-- Existing parents who already have their own patient record: connect only
-- the exact contact UUID of their active guardian grant. Ambiguous accounts
-- with multiple own records are deliberately left for staff to resolve.
WITH own_patient AS (
    SELECT pa.user_id, (array_agg(pa.patient_id))[1] AS patient_id
    FROM patient_assignments pa JOIN users u ON u.id=pa.user_id
    WHERE pa.source <> 'lead_guardian' AND pa.revoked_at IS NULL
      AND u.role='patient' AND u.is_active
    GROUP BY pa.user_id HAVING count(*)=1
), linked AS (
    SELECT l.id, jsonb_agg(CASE WHEN own.patient_id IS NOT NULL
               AND NULLIF(c->>'related_patient_id','') IS NULL
               THEN c || jsonb_build_object('related_patient_id',own.patient_id)
               ELSE c END ORDER BY n) AS contacts
    FROM leads l CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(l.trusted_contacts)='array' THEN l.trusted_contacts ELSE '[]'::jsonb END) WITH ORDINALITY AS entries(c,n)
    LEFT JOIN LATERAL (
        SELECT (array_agg(DISTINCT own.patient_id))[1] AS patient_id
        FROM lead_portal_access a JOIN own_patient own ON own.user_id=a.user_id
        JOIN users u ON u.id=a.user_id
        WHERE a.lead_id=l.id AND a.kind='guardian' AND a.revoked_at IS NULL
          AND a.trusted_contact_id::text=c->>'id'
          AND lower(regexp_replace(btrim(u.name), '\s+', ' ', 'g'))
              = lower(regexp_replace(btrim(c->>'name'), '\s+', ' ', 'g'))
        HAVING count(DISTINCT own.patient_id)=1
    ) own ON true
    WHERE l.qualification_status <> 'deleted'
    GROUP BY l.id
), repaired AS (
    UPDATE leads l SET trusted_contacts=linked.contacts FROM linked
    WHERE l.id=linked.id AND l.trusted_contacts IS DISTINCT FROM linked.contacts
    RETURNING l.id
)
INSERT INTO audit_log(action,entity_type,entity_id,context)
SELECT 'link_existing_guardian_own_patient','lead',id,
       jsonb_build_object('repair','20261014183000_parent_portal_assignment_provenance') FROM repaired;

WITH repaired AS (
    UPDATE patient_relations relation SET related_patient_id=own.patient_id
    FROM leads l, lead_portal_access a, patient_assignments own
    WHERE l.converted_patient_id=relation.patient_id AND a.lead_id=l.id
      AND a.kind='guardian' AND a.revoked_at IS NULL
      AND own.user_id=a.user_id AND own.source <> 'lead_guardian' AND own.revoked_at IS NULL
      AND relation.related_patient_id IS NULL AND relation.relation_type IN ('parent','guardian')
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(l.trusted_contacts)='array' THEN l.trusted_contacts ELSE '[]'::jsonb END) c
                  WHERE c->>'id'=a.trusted_contact_id::text AND c->>'related_patient_id'=own.patient_id::text
                    AND c->>'name'=relation.related_name)
    RETURNING relation.patient_id,relation.related_patient_id
)
INSERT INTO audit_log(action,entity_type,entity_id,context)
SELECT 'link_existing_guardian_patient_relation','patient',patient_id,
       jsonb_build_object('related_patient_id',related_patient_id,
           'repair','20261014183000_parent_portal_assignment_provenance') FROM repaired;
