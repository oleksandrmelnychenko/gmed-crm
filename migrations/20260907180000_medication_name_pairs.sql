-- Staff-entered name pairs for form completion, separate from verified drug identities.
CREATE TABLE medication_name_pairs (
    handelsname TEXT NOT NULL CHECK (char_length(handelsname) <= 500),
    wirkstoff TEXT NOT NULL CHECK (char_length(wirkstoff) BETWEEN 1 AND 500),
    handelsname_key TEXT GENERATED ALWAYS AS (
        lower(regexp_replace(btrim(handelsname), '[[:space:]]+', ' ', 'g'))
    ) STORED,
    wirkstoff_key TEXT GENERATED ALWAYS AS (
        lower(regexp_replace(btrim(wirkstoff), '[[:space:]]+', ' ', 'g'))
    ) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (handelsname_key, wirkstoff_key),
    CHECK (wirkstoff_key <> '')
);

CREATE INDEX medication_name_pairs_by_substance
    ON medication_name_pairs (wirkstoff_key, handelsname_key);

INSERT INTO medication_name_pairs (handelsname, wirkstoff)
SELECT DISTINCT
    btrim(regexp_replace(COALESCE(handelsname, ''), '[[:space:]]+', ' ', 'g')),
    btrim(regexp_replace(wirkstoff, '[[:space:]]+', ' ', 'g'))
FROM patient_medications
WHERE char_length(btrim(COALESCE(handelsname, ''))) <= 500
  AND char_length(btrim(wirkstoff)) BETWEEN 1 AND 500
  AND btrim(regexp_replace(wirkstoff, '[[:space:]]+', ' ', 'g')) <> ''
ON CONFLICT DO NOTHING;
