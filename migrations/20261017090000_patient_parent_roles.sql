ALTER TABLE patient_relations DROP CONSTRAINT patient_relations_relation_type_check;
ALTER TABLE patient_relations ADD CONSTRAINT patient_relations_relation_type_check
    CHECK (relation_type IN ('spouse', 'parent', 'mother', 'father', 'child', 'sibling',
                            'relative', 'guardian', 'caregiver', 'friend', 'other'));

-- Recover an explicit role only where the converted lead unambiguously identifies
-- the same person. Do not infer a role from a name, sex or a generic parent label.
WITH candidates AS (
    SELECT pr.id, min(c->>'relation') AS role
    FROM patient_relations pr
    JOIN leads l ON l.converted_patient_id = pr.patient_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.trusted_contacts, '[]'::jsonb)) c
    WHERE pr.relation_type = 'parent'
      AND c->>'relation' IN ('mother', 'father')
      AND lower(btrim(pr.related_name)) = lower(btrim(c->>'name'))
      AND ((pr.related_patient_id IS NOT NULL AND pr.related_patient_id::text = c->>'related_patient_id')
           OR (NULLIF(btrim(pr.email), '') IS NOT NULL AND lower(btrim(pr.email)) = lower(btrim(c->>'email'))))
    GROUP BY pr.id
    HAVING count(DISTINCT c->>'relation') = 1
)
UPDATE patient_relations pr SET relation_type = candidates.role
FROM candidates WHERE pr.id = candidates.id;
