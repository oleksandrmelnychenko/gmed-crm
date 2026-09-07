-- Informational attachments are not signature sources. Their version and bytes
-- are fixed before an invitation is created.
CREATE TABLE document_signature_attachments (
    request_id UUID PRIMARY KEY REFERENCES document_signature_requests(id),
    document_id UUID NOT NULL REFERENCES documents(id),
    filename TEXT NOT NULL,
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    source_context JSONB NOT NULL,
    stage TEXT NOT NULL DEFAULT 'prepared'
        CHECK (stage IN ('prepared', 'attaching', 'attached', 'inviting', 'sent')),
    provider_attachment_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX document_signature_attachments_document ON document_signature_attachments(document_id);

-- Append-only manager attestations, separate from document.signed_at. A new PDF
-- version has a new document_id and cannot inherit an earlier acknowledgement.
CREATE TABLE document_review_events (
    id UUID PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents(id),
    kind TEXT NOT NULL CHECK (kind IN ('sent', 'acknowledged')),
    actor_id UUID NOT NULL REFERENCES users(id),
    signature_request_id UUID REFERENCES document_signature_requests(id),
    sent_event_id UUID REFERENCES document_review_events(id),
    test_mode BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((kind = 'sent' AND sent_event_id IS NULL) OR
           (kind = 'acknowledged' AND sent_event_id IS NOT NULL))
);
CREATE INDEX document_review_events_document ON document_review_events(document_id, created_at DESC);
CREATE UNIQUE INDEX document_review_sent_once ON document_review_events(signature_request_id)
    WHERE kind = 'sent' AND signature_request_id IS NOT NULL;
CREATE UNIQUE INDEX document_review_ack_once ON document_review_events(sent_event_id)
    WHERE kind = 'acknowledged';
