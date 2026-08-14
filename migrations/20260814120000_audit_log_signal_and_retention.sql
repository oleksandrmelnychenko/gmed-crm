-- Keep the user-facing activity stream useful while bounding the raw HTTP
-- audit footprint. Audit rows remain immutable during normal application
-- work; the retention sweeper must explicitly opt in for DELETE only.

INSERT INTO system_settings (key, value, description)
VALUES (
    'cleanup_audit_http_days',
    '3',
    'Delete low-signal technical HTTP audit entries older than N days'
)
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_audit_meaningful_created
    ON audit_log (created_at DESC)
    WHERE action <> 'http_request';

CREATE INDEX IF NOT EXISTS idx_audit_technical_created
    ON audit_log (created_at DESC)
    WHERE action = 'http_request';

CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE'
       AND current_setting('gmed.audit_retention_cleanup', true) = 'on' THEN
        RETURN OLD;
    END IF;

    RAISE EXCEPTION 'audit_log is immutable — updates and deletes are forbidden';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION prevent_audit_mutation() IS
    'Blocks audit mutations except DELETE inside the explicit daily retention transaction.';
