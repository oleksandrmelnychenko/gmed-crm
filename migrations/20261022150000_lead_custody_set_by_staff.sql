-- Custody stated by staff is read-only in the lead cabinet (owner decision
-- 2026-10-22). The cabinet shows the custody as text with the hint to write
-- to GMED, and the server refuses a cabinet change with 409
-- `custody_set_by_staff`; staff may still change it.
--
-- The flag says who wrote `custody` last: staff (`POST /leads/{id}/
-- representation`, the custody taken over from the patient file on a repeat
-- intake) set it, a cabinet statement clears it. It describes only the
-- current value; the append-only audit log keeps the history.
ALTER TABLE lead_gwg_declarations
    ADD COLUMN IF NOT EXISTS custody_set_by_staff BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN lead_gwg_declarations.custody_set_by_staff IS
    'The current custody was stated by staff (or taken over from the patient file); the lead cabinet shows it read-only.';

-- Existing statements: the latest custody event of the lead decides.
UPDATE lead_gwg_declarations g
   SET custody_set_by_staff = true
 WHERE g.custody IS NOT NULL
   AND (
       SELECT a.action <> 'lead_portal_update_representation'
         FROM audit_log a
        WHERE a.entity_type = 'lead'
          AND a.entity_id = g.lead_id
          AND (
              a.action = 'set_lead_custody'
              OR (a.action = 'prefill_repeat_intake_representatives'
                  AND a.context ->> 'custody' IS NOT NULL)
              OR (a.action = 'lead_portal_update_representation'
                  AND a.context -> 'fields' ? 'custody')
          )
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT 1
   ) IS TRUE;
