CREATE TABLE IF NOT EXISTS direct_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_user   UUID NOT NULL REFERENCES users(id),
    to_user     UUID NOT NULL REFERENCES users(id),
    message     TEXT NOT NULL,
    is_read     BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dm_conversation ON direct_messages(
    LEAST(from_user, to_user), GREATEST(from_user, to_user), created_at DESC
);
CREATE INDEX idx_dm_to_unread ON direct_messages(to_user, is_read) WHERE NOT is_read;
