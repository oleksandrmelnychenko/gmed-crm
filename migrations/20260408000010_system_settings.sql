-- System-wide settings (key-value with typed JSON values).
-- Admin-configurable token lifetimes, session policies, etc.

CREATE TABLE IF NOT EXISTS system_settings (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    description TEXT,
    updated_by  UUID REFERENCES users(id),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default token configuration
INSERT INTO system_settings (key, value, description) VALUES
    ('access_token_minutes',  '15',    'Access token lifetime in minutes (JWT exp)'),
    ('refresh_token_days',    '30',    'Refresh token lifetime in days'),
    ('max_sessions_per_user', '10',    'Maximum concurrent sessions per user'),
    ('session_idle_days',     '7',     'Revoke session after N days of inactivity')
ON CONFLICT (key) DO NOTHING;
