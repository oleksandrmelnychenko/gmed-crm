-- A manually created lead gets a patient login right away (owner decision
-- 2026-10-03): the prospective patient completes the personal data of wizard
-- step 1 and uploads documents, staff continue from step 2. The account lives
-- as long as the lead: the retention purge deactivates and anonymises it.
--
-- The link sits on the lead, not in patient_assignments, because a lead has no
-- patient record until its master data is complete.
ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS portal_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_portal_user_id
    ON leads (portal_user_id)
    WHERE portal_user_id IS NOT NULL;
