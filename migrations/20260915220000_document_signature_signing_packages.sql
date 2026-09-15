-- A single Skribble request may cover more than one source PDF. The signed
-- result remains one cryptographically intact bundle; these rows preserve the
-- exact source versions and hashes covered by that bundle.
ALTER TABLE document_signature_requests
    ADD COLUMN primary_source_sha256 TEXT CHECK (
        primary_source_sha256 IS NULL OR length(primary_source_sha256) = 64
    );

CREATE TABLE document_signature_members (
    request_id UUID NOT NULL REFERENCES document_signature_requests(id),
    document_id UUID NOT NULL REFERENCES documents(id),
    position SMALLINT NOT NULL CHECK (position > 0),
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    source_context JSONB NOT NULL,
    result_document_id UUID REFERENCES documents(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (request_id, document_id),
    UNIQUE (request_id, position)
);

CREATE INDEX document_signature_members_document
    ON document_signature_members(document_id);
