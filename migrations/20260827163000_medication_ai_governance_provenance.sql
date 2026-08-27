-- Persist the internal governance approval under which each external AI job
-- was created. Historical rows cannot be attributed retroactively, so they
-- receive an explicit sentinel that is forbidden for new/runtime jobs.

ALTER TABLE medication_ai_analyses
    ADD COLUMN governance_review_id TEXT NOT NULL DEFAULT 'legacy-unrecorded',
    ADD CONSTRAINT medication_ai_analysis_governance_review_id_shape CHECK (
        governance_review_id ~ '^[A-Za-z0-9._-]{1,96}$'
    );

ALTER TABLE medication_ai_analyses
    ALTER COLUMN governance_review_id DROP DEFAULT;

-- No pre-migration non-terminal job has attributable governance provenance.
-- Fail every such job closed so even a fencing-aware but governance-unaware
-- old worker cannot claim it after this migration. Requested jobs pass through
-- processing only to preserve the installed state/event transition contracts;
-- no provider call is represented and their started_at is cleared on failure.
CREATE TEMPORARY TABLE medication_ai_governance_legacy_nonterminal (
    id UUID PRIMARY KEY,
    original_status TEXT NOT NULL,
    transition_at TIMESTAMPTZ NOT NULL
) ON COMMIT DROP;

INSERT INTO medication_ai_governance_legacy_nonterminal
    (id, original_status, transition_at)
SELECT analysis.id,
       analysis.status,
       GREATEST(
           clock_timestamp(),
           COALESCE(
               max(event.created_at) + interval '1 microsecond',
               '-infinity'::TIMESTAMPTZ
           )
       )
FROM medication_ai_analyses AS analysis
LEFT JOIN medication_ai_analysis_events AS event
  ON event.analysis_id = analysis.id
WHERE analysis.status IN ('requested', 'processing')
GROUP BY analysis.id, analysis.status;

UPDATE medication_ai_analyses AS analysis
SET status = 'processing',
    started_at = legacy.transition_at,
    lease_until = legacy.transition_at + interval '1 second',
    lease_token = gen_random_uuid(),
    updated_at = legacy.transition_at
FROM medication_ai_governance_legacy_nonterminal AS legacy
WHERE analysis.id = legacy.id
  AND legacy.original_status = 'requested';

INSERT INTO medication_ai_analysis_events
    (analysis_id, from_status, to_status, reason_code, created_at)
SELECT id,
       'requested',
       'processing',
       'governance_provenance_migration',
       transition_at
FROM medication_ai_governance_legacy_nonterminal
WHERE original_status = 'requested';

UPDATE medication_ai_analyses AS analysis
SET status = 'failed',
    started_at = CASE
        WHEN legacy.original_status = 'requested' THEN NULL
        ELSE analysis.started_at
    END,
    completed_at = legacy.transition_at + interval '1 microsecond',
    lease_until = NULL,
    lease_token = NULL,
    error_code = 'provider_configuration_changed',
    updated_at = legacy.transition_at + interval '1 microsecond'
FROM medication_ai_governance_legacy_nonterminal AS legacy
WHERE analysis.id = legacy.id;

INSERT INTO medication_ai_analysis_events
    (analysis_id, from_status, to_status, reason_code, created_at)
SELECT id,
       'processing',
       'failed',
       'provider_configuration_changed',
       transition_at + interval '1 microsecond'
FROM medication_ai_governance_legacy_nonterminal;

DROP TABLE medication_ai_governance_legacy_nonterminal;

-- Replace the generated legacy uniqueness rule without depending on its
-- PostgreSQL-truncated name. A renewed governance approval must be able to
-- create a new analysis for the same frozen input/model/prompt contract.
DO $$
DECLARE
    legacy_constraint NAME;
    legacy_constraint_count INTEGER;
BEGIN
    SELECT min(constraint_row.conname::TEXT)::NAME,
           count(*)::INTEGER
    INTO legacy_constraint, legacy_constraint_count
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'medication_ai_analyses'::regclass
      AND constraint_row.contype = 'u'
      AND (
          SELECT array_agg(attribute_row.attname::TEXT ORDER BY key_column.ordinality)
          FROM unnest(constraint_row.conkey)
               WITH ORDINALITY AS key_column(attnum, ordinality)
          JOIN pg_attribute AS attribute_row
            ON attribute_row.attrelid = constraint_row.conrelid
           AND attribute_row.attnum = key_column.attnum
      ) = ARRAY['review_id', 'input_fingerprint', 'provider_model', 'prompt_version'];

    IF legacy_constraint_count <> 1 THEN
        RAISE EXCEPTION
            'expected one legacy medication AI uniqueness constraint, found %',
            legacy_constraint_count;
    END IF;

    EXECUTE format(
        'ALTER TABLE medication_ai_analyses DROP CONSTRAINT %I',
        legacy_constraint
    );
END;
$$;

ALTER TABLE medication_ai_analyses
    ADD CONSTRAINT medication_ai_analysis_review_input_provider_governance_key
    UNIQUE (
        review_id,
        input_fingerprint,
        provider_model,
        prompt_version,
        governance_review_id
    );

CREATE OR REPLACE FUNCTION medication_ai_analysis_governance_review_guard()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.governance_review_id = 'legacy-unrecorded' THEN
        RAISE EXCEPTION 'legacy medication AI governance provenance is reserved';
    ELSIF TG_OP = 'UPDATE'
          AND OLD.governance_review_id = 'legacy-unrecorded'
          AND NEW.status IN ('requested', 'processing') THEN
        RAISE EXCEPTION 'legacy medication AI analysis must remain terminal';
    ELSIF TG_OP = 'UPDATE'
          AND NEW.governance_review_id IS DISTINCT FROM OLD.governance_review_id THEN
        RAISE EXCEPTION 'medication AI governance review provenance is immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER medication_ai_analysis_governance_review_guard
    BEFORE INSERT OR UPDATE ON medication_ai_analyses
    FOR EACH ROW EXECUTE FUNCTION medication_ai_analysis_governance_review_guard();

COMMENT ON COLUMN medication_ai_analyses.governance_review_id IS
    'Immutable bounded internal approval ID; legacy-unrecorded is reserved for migration backfill.';
