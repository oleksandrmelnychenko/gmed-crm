-- Owner decision 2026-11-16 (QA fix-91): an OPEN possible match whose
-- subject data did not change but that the current matcher and list no longer
-- find is closed automatically by re-screening as `no_longer_matches`. It is
-- not a decision of the CEO: `decided_by` stays empty, `decided_at` is the
-- moment of closing and `decision_reason` a fixed system text. Decided hits
-- (`false_positive`, `confirmed`) are never touched; a changed subject (a
-- renamed payer) keeps its open hit (QA 2026-10-12).
DO $$
DECLARE
    status_check RECORD;
BEGIN
    FOR status_check IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'c'
          AND c.conrelid = 'sanctions_hits'::regclass
          AND a.attname = 'status'
          AND array_length(c.conkey, 1) = 1
    LOOP
        EXECUTE format('ALTER TABLE sanctions_hits DROP CONSTRAINT IF EXISTS %I', status_check.conname);
    END LOOP;
END $$;

ALTER TABLE sanctions_hits
    ADD CONSTRAINT sanctions_hits_status_check CHECK (
        status IN ('open', 'false_positive', 'confirmed', 'no_longer_matches')
    );

ALTER TABLE sanctions_hits
    DROP CONSTRAINT IF EXISTS sanctions_hits_decision_check;

ALTER TABLE sanctions_hits
    ADD CONSTRAINT sanctions_hits_decision_check CHECK (
        (status = 'open' AND decided_at IS NULL AND decided_by IS NULL AND decision_reason IS NULL)
        OR (
            status IN ('false_positive', 'confirmed')
            AND decided_at IS NOT NULL
            AND decided_by IS NOT NULL
            AND char_length(btrim(decision_reason)) >= 10
        )
        OR (
            status = 'no_longer_matches'
            AND decided_at IS NOT NULL
            AND decided_by IS NULL
            AND char_length(btrim(decision_reason)) >= 10
        )
    );
