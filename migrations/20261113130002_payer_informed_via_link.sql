-- The payer who accepts the privacy notice in its own link is informed
-- (Art. 14 DSGVO; owner decision 2026-11-13, no. 1): the declaration records
-- the time of the acknowledgement and that it came from the link, without a
-- staff member (`payer_informed_by` stays NULL). NULL here means a person
-- recorded it (staff's tick, the e-mailed invitation, the paying parent's
-- cabinet, the paper form). The source goes with the record: a write that
-- changes or clears `payer_informed_at` clears it.
-- See docs/architecture/lead-payer-declaration_ua.md.

ALTER TABLE lead_payer_declarations
    ADD COLUMN IF NOT EXISTS payer_informed_via TEXT
        CHECK (payer_informed_via IN ('link'));

COMMENT ON COLUMN lead_payer_declarations.payer_informed_via IS
    'link = the payer accepted the privacy notice in its own payer link; NULL = recorded by payer_informed_by.';

-- Payers that already accepted the notice in their own link while the
-- declaration still names them (the link's payer key, compared as the
-- adoption migration does) and nobody has recorded them as informed yet.
UPDATE lead_payer_declarations d
SET payer_informed_at = s.privacy_ack_at,
    payer_informed_by = NULL,
    payer_informed_via = 'link'
FROM lead_payer_statements s
JOIN lead_payer_links k ON k.id = s.link_id
WHERE s.lead_id = d.lead_id
  AND s.source = 'link'
  AND s.privacy_ack_at IS NOT NULL
  AND k.revoked_at IS NULL
  AND d.payer_kind = 'third_party'
  AND d.payer_informed_at IS NULL
  AND k.payer_key = jsonb_build_array(
      COALESCE(d.payer_type, 'person'),
      d.organisation_name,
      d.first_name,
      d.last_name,
      d.date_of_birth
  );
