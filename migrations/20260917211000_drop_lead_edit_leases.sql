-- Lead edit leases are removed. The 180-second lease with a client heartbeat
-- expired in throttled background tabs and kept interrupting the wizard with
-- "editing temporarily unavailable", while leads are in practice worked on by
-- one manager at a time. The rows were transient locks, not business data.
DROP TABLE IF EXISTS lead_edit_leases;
