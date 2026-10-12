-- DSGVO Art. 17: deleting and anonymising a lead (by staff, by a retention
-- rule, or with the erasure of its patient) also removes the words staff
-- typed about it from the audit log (owner decision 2026-10-12, QA A3-02).
-- The free text of «Не подходит» → «Другое» (`qualify_lead`), the free-text
-- reason and the internal note of an archiving (`resolve_failed_lead`) and
-- their copy on the cancellation of the lead's orders (`cancel_order`,
-- `lead_reason`) may name a person or a diagnosis. Since 2026-10-12 new rows
-- keep only the reason's code and whether a text was typed; rows written
-- before keep the text until the lead is deleted.
--
-- audit_log stays append-only. The exception is as narrow as the one for the
-- task history (migration 20261012160000_dsgvo_erasure_task_event_scrub.sql):
--
-- * only inside the deletion's transaction: the transaction-local setting
--   `gmed.dsgvo_erasure = on`, switched on by
--   `leads::scrub_lead_free_text_in_tx` for its statements alone;
-- * only an UPDATE, and only of text values inside `context`
--   (`gmed_jsonb_only_text_changed`): same keys, same structure, same
--   numbers, flags and nulls; no other column (`action`, `entity_*`,
--   `user_id`, `created_at`, `old_value`, `new_value`, …) changes;
-- * a DELETE stays allowed only to the retention sweeper
--   (`gmed.audit_retention_cleanup`), as before.
--
-- The erased text becomes the marker `[erased]`; the deletion's own audit row
-- counts the scrubbed rows (`scrubbed_free_text.audit_rows`). Leads deleted
-- before this migration get the same scrub once, below.

CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE'
       AND current_setting('gmed.audit_retention_cleanup', true) = 'on' THEN
        RETURN OLD;
    END IF;

    -- Art. 17 DSGVO exception: only inside a deletion / erasure, only an
    -- UPDATE, only text values of `context`.
    IF TG_OP = 'UPDATE'
       AND current_setting('gmed.dsgvo_erasure', true) = 'on'
       AND OLD.context IS NOT NULL
       AND NEW.context IS NOT NULL
       AND (to_jsonb(NEW) - 'context') = (to_jsonb(OLD) - 'context')
       AND gmed_jsonb_only_text_changed(OLD.context, NEW.context) THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'audit_log is immutable — updates and deletes are forbidden';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION prevent_audit_mutation() IS
    'Blocks audit mutations except DELETE inside the daily retention transaction and, inside a DSGVO deletion (gmed.dsgvo_erasure = on), an UPDATE of text values of context only.';

-- Whether a lead's failure reason is staff's own words: not one of the listed
-- reasons and no system code (lower-case letters, digits and at least one
-- `_`, at most 64 characters). The same rule as
-- `leads::failure_reason_is_free_text`; a blank text is none.
CREATE OR REPLACE FUNCTION gmed_lead_failure_reason_is_free_text(reason TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT btrim(COALESCE(reason, '')) <> ''
       AND btrim(reason) NOT IN (
           'not_our_lead', 'no_response', 'patient_declined', 'other_provider',
           'costs', 'duplicate', 'other'
       )
       AND NOT (
           btrim(reason) ~ '^[a-z0-9_]{1,64}$'
           AND strpos(btrim(reason), '_') > 0
       )
$$;

COMMENT ON FUNCTION gmed_lead_failure_reason_is_free_text(TEXT) IS
    'True when a lead failure reason is free text, not a listed reason or a system code (leads::failure_reason_is_free_text).';

-- Leads deleted and anonymised before 2026-10-12's rule: their history and
-- their audit rows lose staff's words now, as a deletion does from now on.
SELECT set_config('gmed.dsgvo_erasure', 'on', true);

UPDATE workflow_lifecycle_events event
SET note = CASE
        WHEN event.transition_kind IN ('status_change', 'archived', 'deleted')
             AND event.note IS NOT NULL
             AND gmed_lead_failure_reason_is_free_text(event.note) THEN 'other'
        WHEN event.transition_kind IN ('status_change', 'archived', 'deleted')
             AND event.note IS NOT NULL THEN btrim(event.note)
        ELSE event.note
    END,
    metadata = CASE
        WHEN jsonb_typeof(event.metadata -> 'note') IS NOT NULL
             AND jsonb_typeof(event.metadata -> 'note') <> 'null' THEN event.metadata - 'note'
        ELSE event.metadata
    END
FROM leads lead
WHERE event.entity_type = 'lead'
  AND event.entity_id = lead.id
  AND (lead.qualification_status = 'deleted'
       OR COALESCE(lead.failed_outcome_status, 'none') = 'delete_anonymized')
  AND (
      (event.transition_kind IN ('status_change', 'archived', 'deleted')
       AND event.note IS NOT NULL
       AND event.note IS DISTINCT FROM CASE
           WHEN gmed_lead_failure_reason_is_free_text(event.note) THEN 'other'
           ELSE btrim(event.note)
       END)
      OR (jsonb_typeof(event.metadata -> 'note') IS NOT NULL
          AND jsonb_typeof(event.metadata -> 'note') <> 'null')
  );

WITH deleted_leads AS (
    SELECT id FROM leads
    WHERE qualification_status = 'deleted'
       OR COALESCE(failed_outcome_status, 'none') = 'delete_anonymized'
), targets AS (
    SELECT audit.id, audit.context
    FROM audit_log audit
    JOIN deleted_leads lead
      ON (audit.entity_type = 'lead'
          AND audit.entity_id = lead.id
          AND audit.action IN ('qualify_lead', 'resolve_failed_lead'))
      OR (audit.entity_type = 'order'
          AND audit.action = 'cancel_order'
          AND audit.context ->> 'source_lead_id' = lead.id::text)
    WHERE jsonb_typeof(audit.context) = 'object'
), scrubbed AS (
    SELECT id,
           context
           || CASE
                  WHEN jsonb_typeof(context -> 'reason') = 'string'
                       AND context ->> 'reason' <> '[erased]'
                       AND gmed_lead_failure_reason_is_free_text(context ->> 'reason')
                  THEN jsonb_build_object('reason', '[erased]')
                  ELSE '{}'::jsonb
              END
           || CASE
                  WHEN jsonb_typeof(context -> 'lead_reason') = 'string'
                       AND context ->> 'lead_reason' <> '[erased]'
                       AND gmed_lead_failure_reason_is_free_text(context ->> 'lead_reason')
                  THEN jsonb_build_object('lead_reason', '[erased]')
                  ELSE '{}'::jsonb
              END
           || CASE
                  WHEN jsonb_typeof(context -> 'note') = 'string'
                       AND context ->> 'note' <> '[erased]'
                  THEN jsonb_build_object('note', '[erased]')
                  ELSE '{}'::jsonb
              END AS context
    FROM targets
)
UPDATE audit_log audit
SET context = scrubbed.context
FROM scrubbed
WHERE audit.id = scrubbed.id
  AND audit.context IS DISTINCT FROM scrubbed.context;

SELECT set_config('gmed.dsgvo_erasure', 'off', true);
