-- The agreement of the plan with the patient stays manual (owner decision
-- 2026-11-02, question 4): the planning section records that the plan was
-- sent to the patient before the answer (agreed / correction requested) and
-- the finalisation.
ALTER TABLE order_planning_preparation
    DROP CONSTRAINT IF EXISTS order_planning_preparation_treatment_plan_status_check;
ALTER TABLE order_planning_preparation
    ADD CONSTRAINT order_planning_preparation_treatment_plan_status_check
        CHECK (treatment_plan_status IN ('draft', 'sent', 'agreed', 'correction_requested', 'finalized'));
