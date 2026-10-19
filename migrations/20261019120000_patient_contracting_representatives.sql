-- Contracting party of a converted minor (owner decision 2026-10-19): the
-- parent(s) or guardian who represent the child are the Auftraggeber, never
-- every parent relation on file. The conversion of a minor's lead stores the
-- custody stated on the lead and the patient relations of the parents who
-- represent the child (rep1, and rep2 under joint custody).
--
-- `contracting_relation_ids` is the patient-level default for orders and
-- framework contracts that name no representatives of their own
-- (`contracting_relation_ids` of those tables still wins). Empty means the
-- previous rule: every recorded parent and guardian. No backfill: older
-- conversions keep that rule until staff choose on the contract or order.
ALTER TABLE patients
    ADD COLUMN IF NOT EXISTS custody TEXT,
    ADD COLUMN IF NOT EXISTS contracting_relation_ids UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_custody_check;
ALTER TABLE patients
    ADD CONSTRAINT patients_custody_check CHECK (
        custody IS NULL OR custody IN ('joint', 'sole_parent', 'guardian')
    );
