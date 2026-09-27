-- The automatic "Upcoming concierge service" reminder and the preparation task
-- of a non-medical appointment are due ahead of the service start, not at it.
INSERT INTO system_settings (key, value, description)
VALUES
    (
        'concierge_reminder_lead_hours',
        '24',
        'Hours before a concierge service that its assigned concierge is reminded of it'
    ),
    (
        'concierge_prep_lead_hours',
        '2',
        'Hours before a concierge service that its preparation task is due'
    )
ON CONFLICT (key) DO NOTHING;
