-- B-4: old payer snapshots can contain identities, bank details and free text.
-- Keep the event and its non-text structure; erase string values only for the
-- four historical payer diff actions, on erasure of their source lead.
CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE'
       AND current_setting('gmed.audit_retention_cleanup', true) = 'on' THEN
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE'
       AND current_setting('gmed.dsgvo_erasure', true) = 'on'
       AND OLD.context IS NOT NULL AND NEW.context IS NOT NULL
       AND (to_jsonb(NEW) - 'context') = (to_jsonb(OLD) - 'context')
       AND gmed_jsonb_only_text_changed(OLD.context, NEW.context) THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE'
       AND current_setting('gmed.dsgvo_erasure', true) = 'on'
       AND OLD.action IN ('update_lead_payer_declaration', 'lead_portal_update_payer_declaration',
                          'payer_link_adopt_payer_declaration', 'set_order_payer')
       AND (to_jsonb(NEW) - 'old_value' - 'new_value') = (to_jsonb(OLD) - 'old_value' - 'new_value')
       AND NEW.old_value IS NOT DISTINCT FROM gmed_scrub_jsonb_text(OLD.old_value, '(?s)^.+$', '[erased]')
       AND NEW.new_value IS NOT DISTINCT FROM gmed_scrub_jsonb_text(OLD.new_value, '(?s)^.+$', '[erased]')
       AND EXISTS (
           SELECT 1 FROM leads l WHERE l.qualification_status = 'deleted'
             AND ((OLD.entity_type = 'lead' AND OLD.entity_id = l.id)
                  OR (OLD.entity_type = 'order' AND OLD.action = 'set_order_payer'
                      AND EXISTS (SELECT 1 FROM orders o WHERE o.id = OLD.entity_id
                          AND o.source_lead_id = l.id)))
       ) THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'audit_log is immutable — updates and deletes are forbidden';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION prevent_audit_mutation() IS
    'Append-only audit: retention DELETE, controlled context text erasure, and deterministic text-only erasure of legacy payer snapshots for deleted source leads.';

-- Apply the same deterministic scrub once to leads already erased.
SELECT set_config('gmed.dsgvo_erasure', 'on', true);
UPDATE audit_log a
SET old_value = gmed_scrub_jsonb_text(a.old_value, '(?s)^.+$', '[erased]'),
    new_value = gmed_scrub_jsonb_text(a.new_value, '(?s)^.+$', '[erased]')
WHERE a.action IN ('update_lead_payer_declaration', 'lead_portal_update_payer_declaration',
                   'payer_link_adopt_payer_declaration', 'set_order_payer')
  AND (a.old_value IS DISTINCT FROM gmed_scrub_jsonb_text(a.old_value, '(?s)^.+$', '[erased]')
       OR a.new_value IS DISTINCT FROM gmed_scrub_jsonb_text(a.new_value, '(?s)^.+$', '[erased]'))
  AND EXISTS (SELECT 1 FROM leads l WHERE l.qualification_status = 'deleted'
       AND ((a.entity_type = 'lead' AND a.entity_id = l.id)
            OR (a.entity_type = 'order' AND a.action = 'set_order_payer'
                AND EXISTS (SELECT 1 FROM orders o WHERE o.id = a.entity_id
                    AND o.source_lead_id = l.id))));
SELECT set_config('gmed.dsgvo_erasure', 'off', true);
