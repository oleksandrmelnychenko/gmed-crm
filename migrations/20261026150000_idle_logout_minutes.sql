-- Automatic sign-out after inactivity becomes a CEO setting (owner decision
-- 2026-10-26: signed out "far too often" after the fixed 30 minutes).
-- Minutes without input before the browser signs out: 15–720, 0 = off.
-- The value reaches every signed-in client in `GET /me`.
INSERT INTO system_settings (key, value, description) VALUES
    ('idle_logout_minutes', '120',
     'Sign out in the browser after N minutes without input (15–720, 0 = disabled)')
ON CONFLICT (key) DO NOTHING;
