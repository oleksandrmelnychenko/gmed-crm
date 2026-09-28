-- Daily compliance deadline digest for CEO and IT admin: data subject requests
-- due soon or overdue, breaches inside or past the 72-hour authority deadline,
-- and consents that expire soon. One row per German calendar day records that
-- the digest went out, so several server instances or restarts send it once.
CREATE TABLE IF NOT EXISTS compliance_digest_runs (
    digest_date DATE PRIMARY KEY,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    recipients INTEGER NOT NULL DEFAULT 0,
    summary JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE compliance_digest_runs IS
    'One row per Europe/Berlin calendar day on which the compliance deadline digest was evaluated (and sent when anything was due).';
