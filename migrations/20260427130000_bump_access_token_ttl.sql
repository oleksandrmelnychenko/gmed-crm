-- Raise default access token lifetime from 15 to 60 minutes.
-- Only updates the original seeded value to preserve any admin override.
UPDATE system_settings
SET value = '60'::jsonb
WHERE key = 'access_token_minutes' AND value = '15'::jsonb;
