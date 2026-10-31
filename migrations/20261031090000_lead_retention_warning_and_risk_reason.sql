-- The archived-lead sweep (cleanup_archived_leads_days) warns staff first, like
-- the 14-day rule: no lead is deleted without a warning (owner 2026-10-24). A
-- table of its own, because the sweep counts from `leads.updated_at`, which
-- every write to the lead row would move.
CREATE TABLE IF NOT EXISTS lead_archived_retention_warnings (
    lead_id UUID PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
    warned_at TIMESTAMPTZ NOT NULL
);

-- A purged lead leaves no words of staff behind (A3-02). The history stays
-- append-only: inside a DSGVO deletion (`gmed.dsgvo_erasure = on`, set for the
-- transaction) only the free text of a decision may change.
CREATE OR REPLACE FUNCTION lead_risk_history_append_only() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE'
       AND TG_TABLE_NAME = 'lead_risk_decisions'
       AND current_setting('gmed.dsgvo_erasure', true) = 'on'
       AND to_jsonb(NEW) - 'reason' = to_jsonb(OLD) - 'reason' THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

-- At level one only the mandatory country answers (blocks F, R) hold a lead:
-- another open block kept the guarded actions waiting for a decision nobody
-- could take. The next reassessment sets the true value.
ALTER TABLE lead_risk_assessments
    ADD COLUMN IF NOT EXISTS country_answers_pending BOOLEAN NOT NULL DEFAULT true;
