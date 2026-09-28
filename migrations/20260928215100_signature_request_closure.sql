-- Electronic signatures (owner decision 2026-09-28, Q9): a request that can
-- no longer be tracked must not stay active forever, and `needs_review` needs
-- a resolution. Who closed a request, when, how and why is kept on the row;
-- the audit log carries the same event.
ALTER TABLE document_signature_requests
    ADD COLUMN IF NOT EXISTS closed_kind TEXT,
    ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS close_reason TEXT;

ALTER TABLE document_signature_requests
    DROP CONSTRAINT IF EXISTS document_signature_requests_closed_kind_check;
ALTER TABLE document_signature_requests
    ADD CONSTRAINT document_signature_requests_closed_kind_check
    CHECK (closed_kind IS NULL OR closed_kind IN (
        'auto_expired',     -- age cap reached while untrackable (system)
        'abandoned',        -- given up by staff, with a reason
        'review_accepted',  -- needs_review -> completed, with a reason
        'review_rejected'   -- needs_review -> error, with a reason
    ));

COMMENT ON COLUMN document_signature_requests.closed_kind IS
    'How a request was closed outside the provider status: auto_expired, abandoned, review_accepted, review_rejected.';

-- Requests the poller cannot resolve (no provider id after an unknown
-- submission, or the provider no longer knows the request) move to `error`
-- after this many days.
INSERT INTO system_settings (key, value, description)
VALUES (
    'signature_stuck_request_days',
    '3',
    'Days after which a signature request that cannot be tracked at the provider is closed as an error'
)
ON CONFLICT (key) DO NOTHING;
