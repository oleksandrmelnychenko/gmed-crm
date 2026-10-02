-- Owner decision 2026-10-02: the daily anchor of the personnel archive is
-- time-stamped by Sectigo (RFC 3161, not qualified, free of charge). Only the
-- anchor hash is sent to the service. An address the CEO already entered stays.
UPDATE system_settings
SET value = '"https://timestamp.sectigo.com"'::jsonb
WHERE key = 'personnel_tsa_url'
  AND value = '""'::jsonb;
