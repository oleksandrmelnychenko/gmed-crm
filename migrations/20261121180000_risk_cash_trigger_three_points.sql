-- Owner 2026-11-21: cash payment (T9) counts 3 points, not 4, so cash alone
-- is no enhanced check. The code default changed; a configuration the CEO
-- saved before still says 4 and would keep it. Only that exact old value is
-- changed (a different value is a deliberate choice and stays); the version
-- moves so open leads are reassessed with the new points.
UPDATE system_settings
SET value = jsonb_set(
        jsonb_set(value, '{points,T9}', '3'::jsonb),
        '{version}',
        to_jsonb(COALESCE((value ->> 'version')::int, 1) + 1)
    ),
    updated_at = now()
WHERE key = 'risk_assessment_config'
  AND value -> 'points' ->> 'T9' = '4';
