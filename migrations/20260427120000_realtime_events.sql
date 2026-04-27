CREATE TABLE IF NOT EXISTS realtime_events (
    seq             BIGSERIAL PRIMARY KEY,
    id              UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    event_type      TEXT NOT NULL,
    entity_type     TEXT NOT NULL,
    entity_id       UUID NOT NULL,
    patient_id      UUID,
    actor_user_id   UUID,
    target_user_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    role_names      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    payload         JSONB NOT NULL DEFAULT '{}'::JSONB,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_realtime_events_occurred_at
    ON realtime_events(occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_realtime_events_patient_seq
    ON realtime_events(patient_id, seq)
    WHERE patient_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_realtime_events_target_users
    ON realtime_events USING GIN(target_user_ids);

CREATE INDEX IF NOT EXISTS idx_realtime_events_roles
    ON realtime_events USING GIN(role_names);
