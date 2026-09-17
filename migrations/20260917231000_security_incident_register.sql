-- Art. 33 Abs. 5 DSGVO: every personal data breach is documented, including
-- the minor ones that are not reported. `became_aware_at` starts the 72 hour
-- clock for the supervisory authority; when no report is filed the reason has
-- to be on record instead.
CREATE TABLE security_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('confidentiality', 'integrity', 'availability')),
    severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'contained', 'resolved', 'closed')),
    occurred_at TIMESTAMPTZ,
    became_aware_at TIMESTAMPTZ NOT NULL,
    affected_subjects_count INTEGER CHECK (affected_subjects_count IS NULL OR affected_subjects_count >= 0),
    data_categories TEXT[] NOT NULL DEFAULT '{}',
    risk_assessment TEXT NOT NULL DEFAULT 'pending'
        CHECK (risk_assessment IN ('pending', 'no_risk', 'risk', 'high_risk')),
    authority_notified_at TIMESTAMPTZ,
    authority_reference TEXT,
    no_notification_reason TEXT,
    subjects_notified_at TIMESTAMPTZ,
    root_cause TEXT,
    measures_taken TEXT,
    reported_by UUID NOT NULL REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_security_incidents_status ON security_incidents (status, became_aware_at DESC);

CREATE SEQUENCE security_incident_reference_seq;
