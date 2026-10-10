-- Follow-up blocks K (birth data) and L (legal questions), owner 2026-10-09:
-- staff may request them like the blocks A-J. The original checks allowed only
-- A-J, so a request for K or L failed with a constraint violation.
ALTER TABLE lead_risk_assessments
    DROP CONSTRAINT IF EXISTS lead_risk_assessments_requested_blocks_check;
ALTER TABLE lead_risk_assessments
    ADD CONSTRAINT lead_risk_assessments_requested_blocks_check CHECK (
        requested_blocks <@ ARRAY['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']::text[]
    );

ALTER TABLE lead_risk_decisions
    DROP CONSTRAINT IF EXISTS lead_risk_decisions_blocks_check;
ALTER TABLE lead_risk_decisions
    ADD CONSTRAINT lead_risk_decisions_blocks_check CHECK (
        blocks <@ ARRAY['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']::text[]
    );
