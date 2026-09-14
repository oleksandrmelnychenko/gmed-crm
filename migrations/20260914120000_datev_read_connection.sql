CREATE TABLE datev_read_connection (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    revision uuid NOT NULL,
    generation uuid NOT NULL,
    mode text NOT NULL CHECK (mode IN ('sandbox', 'production')),
    redirect_uri text NOT NULL,
    exchange_enabled boolean NOT NULL DEFAULT false,
    ciphertext bytea NOT NULL,
    nonce bytea NOT NULL,
    key_id text NOT NULL,
    token_ciphertext bytea,
    token_nonce bytea,
    token_key_id text,
    status text NOT NULL DEFAULT 'disconnected',
    connected_by uuid REFERENCES users(id),
    expires_at timestamptz,
    checked_at timestamptz,
    checked_consultant integer,
    checked_client integer,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE datev_oauth_pending (
    state_hash text PRIMARY KEY,
    browser_hash text NOT NULL,
    actor_id uuid NOT NULL REFERENCES users(id),
    revision uuid NOT NULL,
    generation uuid NOT NULL,
    ciphertext bytea NOT NULL,
    nonce bytea NOT NULL,
    key_id text NOT NULL,
    expires_at timestamptz NOT NULL
);
CREATE INDEX datev_oauth_pending_expiry ON datev_oauth_pending(expires_at);

-- Operational history contains no tokens, invoice contents, or upstream error bodies.
CREATE TABLE datev_read_events (
    id uuid PRIMARY KEY,
    actor_id uuid NOT NULL REFERENCES users(id),
    operation text NOT NULL,
    outcome text NOT NULL,
    record_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX datev_read_events_time ON datev_read_events(created_at DESC);
