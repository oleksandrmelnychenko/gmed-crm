-- Automatic reminders are sent by the system, not by a person (QA D2-12,
-- 2026-10-12).
--
-- The hourly dunning run recorded its reminders with the oldest active
-- Billing user as author and an English note ("[system auto-dunning] …"):
-- the invoice card and the audit trail named an employee who never sent the
-- letter. Automatic steps are now marked `automatic`, keep no author and no
-- note (the UI words them by level, RU/DE), and their audit rows have no
-- actor. Manual steps keep their author.
--
-- Earlier automatic steps are recognised by their note and marked
-- `automatic`; their stored author is left as it was (history), the UI shows
-- "System" for every automatic step.

ALTER TABLE invoice_dunning_events
    ADD COLUMN IF NOT EXISTS automatic BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE invoice_dunning_events
    ALTER COLUMN created_by DROP NOT NULL;

UPDATE invoice_dunning_events
SET automatic = true
WHERE NOT automatic
  AND note LIKE '[system auto-dunning]%';

ALTER TABLE invoice_dunning_events
    DROP CONSTRAINT IF EXISTS invoice_dunning_events_author_check;
ALTER TABLE invoice_dunning_events
    ADD CONSTRAINT invoice_dunning_events_author_check
    CHECK (automatic OR created_by IS NOT NULL);

COMMENT ON COLUMN invoice_dunning_events.automatic IS
    'Sent by the automatic dunning run (no author); manual steps name created_by';
