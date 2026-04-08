ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_history JSONB DEFAULT '[]'::jsonb;

ALTER TABLE token_families ADD COLUMN IF NOT EXISTS geo_data JSONB;

CREATE TABLE IF NOT EXISTS ip_whitelist (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cidr        TEXT NOT NULL,
    description TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO system_settings (key, value, description) VALUES
    ('password_min_length',         '8',     'Minimum password length'),
    ('password_require_uppercase',  'true',  'Require at least one uppercase letter'),
    ('password_require_number',     'true',  'Require at least one digit'),
    ('password_expire_days',        '90',    'Force password change after N days (0 = disabled)'),
    ('max_failed_login_attempts',   '5',     'Lock account after N failed login attempts'),
    ('lockout_duration_minutes',    '30',    'Account lockout duration in minutes'),
    ('ip_whitelist_enabled',        'false', 'Enable IP whitelist (only allowed IPs can login)'),
    ('maintenance_mode',            'false', 'Enable maintenance mode (only IT admin can access)'),
    ('maintenance_message',         '"System maintenance in progress"', 'Message shown during maintenance'),
    ('cleanup_expired_tokens_days', '7',     'Delete expired tokens older than N days'),
    ('cleanup_audit_log_days',      '365',   'Delete audit log entries older than N days'),
    ('cleanup_archived_leads_days', '180',   'Delete archived leads older than N days')
ON CONFLICT (key) DO NOTHING;
