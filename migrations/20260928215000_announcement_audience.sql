-- Announcement audience (owner decision 2026-09-28): an announcement reaches
-- staff, patients (portal) or everyone. Until now every active announcement
-- reached every signed-in account, staff and patients alike, so existing rows
-- keep `all`: nothing in them marks an announcement as staff-only reliably.
ALTER TABLE announcements
    ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'all';

ALTER TABLE announcements
    DROP CONSTRAINT IF EXISTS announcements_audience_check;
ALTER TABLE announcements
    ADD CONSTRAINT announcements_audience_check
    CHECK (audience IN ('staff', 'patients', 'all'));

COMMENT ON COLUMN announcements.audience IS
    'Who sees the announcement: staff (all staff roles), patients (portal accounts) or all.';

-- An error-level announcement cannot be dismissed while it is active
-- (enforced by POST /announcements/{id}/dismiss); drop dismissals recorded for
-- currently active error announcements so they show again.
DELETE FROM announcement_dismissals dismissal
USING announcements a
WHERE a.id = dismissal.announcement_id
  AND a.variant = 'error'
  AND a.is_active = true
  AND a.starts_at <= now()
  AND (a.ends_at IS NULL OR a.ends_at > now());
