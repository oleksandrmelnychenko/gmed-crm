-- Durable outbox and evidence for German eIDAS signing. Never cascade away evidence.
CREATE TABLE document_signature_requests (
    id UUID PRIMARY KEY,
    source_document_id UUID NOT NULL REFERENCES documents(id),
    requested_by UUID NOT NULL REFERENCES users(id),
    source_sha256 TEXT NOT NULL,
    source_context JSONB NOT NULL,
    signers JSONB NOT NULL,
    provider_account TEXT NOT NULL,
    test_mode BOOLEAN NOT NULL,
    provider_request_id UUID,
    status TEXT NOT NULL CHECK (status IN (
        'submitting', 'submission_unknown', 'pending', 'completed',
        'needs_review', 'declined', 'withdrawn', 'expired', 'error'
    )),
    evidence JSONB NOT NULL DEFAULT '{}',
    result_document_id UUID REFERENCES documents(id),
    report_storage_key TEXT,
    report_sha256 TEXT,
    signed_sha256 TEXT,
    last_error TEXT,
    next_poll_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_until TIMESTAMPTZ,
    lease_token UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider_account, provider_request_id),
    CHECK (status NOT IN ('completed', 'needs_review') OR
        (result_document_id IS NOT NULL AND report_storage_key IS NOT NULL
         AND signed_sha256 IS NOT NULL AND report_sha256 IS NOT NULL))
);

CREATE UNIQUE INDEX document_signature_one_active ON document_signature_requests(source_document_id)
    WHERE status IN ('submitting', 'submission_unknown', 'pending');
CREATE INDEX document_signature_poll ON document_signature_requests(next_poll_at)
    WHERE status IN ('pending', 'submitting');
