-- The 1-week / 1-month / 6-month follow-up milestones of an order could only
-- be satisfied by a follow-up visit or a reminder with a specific title;
-- marking a milestone "scheduled" in the order's follow-up section did not
-- count. A milestone now records the planned date: "scheduled" with a date
-- satisfies the follow-up gate, like a follow-up visit or reminder does. The
-- order page prefills the date from the closure anchor (+7 days, +1 month,
-- +6 months) and can create the reminder or visit for it directly.
ALTER TABLE order_followup_flows
    ADD COLUMN IF NOT EXISTS followup_1w_date DATE,
    ADD COLUMN IF NOT EXISTS followup_1m_date DATE,
    ADD COLUMN IF NOT EXISTS followup_6m_date DATE;

COMMENT ON COLUMN order_followup_flows.followup_1w_date IS
    'Planned date of the 1-week follow-up; with status scheduled it satisfies the follow-up gate.';
COMMENT ON COLUMN order_followup_flows.followup_1m_date IS
    'Planned date of the 1-month follow-up; with status scheduled it satisfies the follow-up gate.';
COMMENT ON COLUMN order_followup_flows.followup_6m_date IS
    'Planned date of the 6-month follow-up; with status scheduled it satisfies the follow-up gate.';
