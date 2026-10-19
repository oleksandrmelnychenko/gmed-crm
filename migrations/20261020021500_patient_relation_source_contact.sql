-- The lead's trusted contact a patient relation was created from (the id of
-- the `leads.trusted_contacts` entry). A repeat conversion finds the relation
-- of the same entry by it, even when the name was corrected or the relation
-- became "mother"/"father" instead of "parent" (audit 2026-10-20: such
-- changes created a second relation that the contracting party pointed at).
-- Relations of earlier conversions have none and are matched by the linked
-- patient record or a compatible name, as before.
ALTER TABLE patient_relations
    ADD COLUMN IF NOT EXISTS source_contact_id UUID;
