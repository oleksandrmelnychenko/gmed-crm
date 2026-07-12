-- Lead lifecycle status becomes the single source of truth.
-- See docs/lead-status-strategy-ua.md.
--   1) status_changed_at: when the status last changed, to surface "days in status".
--   2) 'deleted': an explicit terminal so anonymized leads stop masquerading as 'archived'.

-- 1) Track the last status change. New rows default to now(); backfill existing
--    rows to creation time (there is no per-status timestamp historically).
ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE leads SET status_changed_at = created_at;

CREATE INDEX IF NOT EXISTS idx_leads_status_changed_at ON leads(status_changed_at);

-- 2) Allow the explicit 'deleted' terminal status.
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_qualification_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_qualification_status_check
    CHECK (qualification_status IN (
        'new', 'in_progress', 'qualified', 'not_qualified', 'converted', 'archived', 'deleted'
    ));

-- 3) Fold already-anonymized leads (failed_outcome_status = 'delete_anonymized')
--    into the explicit 'deleted' status. The failed_* columns remain as the
--    reason/metadata trail; failed_outcome_status stops being written going forward.
UPDATE leads
SET qualification_status = 'deleted',
    status_changed_at = COALESCE(failed_processed_at, status_changed_at)
WHERE failed_outcome_status = 'delete_anonymized'
  AND qualification_status = 'archived';
