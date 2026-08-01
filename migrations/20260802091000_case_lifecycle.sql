-- Case lifecycle state-machine fields.
-- See docs/case-patient-unification-strategy-ua.md (D4).
--   1) closed_reason/closed_at: why and when an episode was closed.
--   2) status_changed_at: when the status last changed, to surface "days in status".

ALTER TABLE cases
    ADD COLUMN IF NOT EXISTS closed_reason TEXT,
    ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_closed_reason_check;
ALTER TABLE cases ADD CONSTRAINT cases_closed_reason_check
    CHECK (closed_reason IS NULL OR closed_reason IN ('abgeschlossen', 'abgebrochen', 'dublette'));

-- Backfill existing rows to creation time (there is no per-status timestamp historically).
UPDATE cases SET status_changed_at = created_at;

CREATE INDEX IF NOT EXISTS idx_cases_status_changed_at ON cases(status_changed_at);
