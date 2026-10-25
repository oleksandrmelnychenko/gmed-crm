-- Four eyes at risk level 3 removed (owner decision 2026-10-25): a reviewer
-- (the CEO or a deputy named in the risk configuration) releases or rejects a
-- level-3 lead at once, like at level 2, always with a reason (the server
-- answers 422 `reason_required`; the CHECK on `reason` stays). Level 3 itself
-- stays: K.o. stop, hold until decided, notifications, enhanced check.
--
-- Additive and safe on existing data; no decision row is changed (the table
-- is append-only).
--
-- `four_eyes` says under which rule a row was recorded:
--   NULL  — recorded before this migration: a level-3 release / reject that
--           neither confirms nor withdraws is a proposal awaiting its
--           confirmation, as it was then (any reviewer can still confirm or
--           withdraw it, so nothing is stranded);
--   false — recorded since: effective at once, a single reviewer's decision
--           (the server writes it explicitly on every new row).
-- The column is added WITHOUT a default first, so existing rows stay NULL;
-- the default applies to new rows only.
ALTER TABLE lead_risk_decisions
    ADD COLUMN IF NOT EXISTS four_eyes BOOLEAN;
ALTER TABLE lead_risk_decisions
    ALTER COLUMN four_eyes SET DEFAULT false;

COMMENT ON COLUMN lead_risk_decisions.four_eyes IS
    'NULL: recorded before 2026-10-25 (a level-3 release/reject was a proposal for a second reviewer). false: a single reviewer''s decision, effective at once (owner decision 2026-10-25).';

-- A pending proposal from before may now be confirmed by any reviewer, the
-- proposer included: one reviewer's decision suffices.
DROP TRIGGER IF EXISTS trg_lead_risk_decisions_four_eyes ON lead_risk_decisions;
DROP FUNCTION IF EXISTS lead_risk_decisions_four_eyes();
