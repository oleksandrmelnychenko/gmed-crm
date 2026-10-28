-- A guardian's own record names the child as ward (Mündel), not as child
-- (owner decision 2026-10-28). Only the reverse rows of a guardian relation
-- change: the child's record names this person as guardian.
ALTER TABLE patient_relations DROP CONSTRAINT patient_relations_relation_type_check;
ALTER TABLE patient_relations ADD CONSTRAINT patient_relations_relation_type_check
    CHECK (relation_type IN ('spouse', 'parent', 'mother', 'father', 'child', 'sibling',
                            'relative', 'guardian', 'ward', 'caregiver', 'friend', 'other'));

UPDATE patient_relations reverse SET relation_type = 'ward'
WHERE reverse.relation_type = 'child'
  AND reverse.related_patient_id IS NOT NULL
  AND EXISTS (
      SELECT 1 FROM patient_relations forward
      WHERE forward.patient_id = reverse.related_patient_id
        AND forward.related_patient_id = reverse.patient_id
        AND forward.relation_type = 'guardian'
  )
  AND NOT EXISTS (
      SELECT 1 FROM patient_relations forward
      WHERE forward.patient_id = reverse.related_patient_id
        AND forward.related_patient_id = reverse.patient_id
        AND forward.relation_type IN ('parent', 'mother', 'father')
  );
