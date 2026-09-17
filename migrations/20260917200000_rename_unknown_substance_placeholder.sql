-- The "Wirkstoff" field is now labelled "ACT-Bedeutung"; rename the stored
-- placeholder that 20260712105000 wrote for rows without a substance.
UPDATE patient_medications
SET wirkstoff = 'Unbekannte ACT-Bedeutung'
WHERE lower(btrim(wirkstoff)) = 'unbekannter wirkstoff';

-- The name dictionary is keyed by (handelsname_key, wirkstoff_key): drop rows
-- whose renamed pair already exists, then rename the rest.
DELETE FROM medication_name_pairs old
WHERE old.wirkstoff_key = 'unbekannter wirkstoff'
  AND EXISTS (
      SELECT 1 FROM medication_name_pairs renamed
      WHERE renamed.handelsname_key = old.handelsname_key
        AND renamed.wirkstoff_key = 'unbekannte act-bedeutung'
  );

UPDATE medication_name_pairs
SET wirkstoff = 'Unbekannte ACT-Bedeutung'
WHERE wirkstoff_key = 'unbekannter wirkstoff';
