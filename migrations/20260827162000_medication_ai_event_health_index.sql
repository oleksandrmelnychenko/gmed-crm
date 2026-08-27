-- Support PHI-free System Health aggregation for lease recovery/exhaustion.
-- The partial index contains only bounded reason codes and timestamps.

CREATE INDEX idx_medication_ai_analysis_events_lease_health
    ON medication_ai_analysis_events(reason_code, created_at DESC)
    WHERE reason_code IN ('worker_lease_expired', 'worker_lease_exhausted');
