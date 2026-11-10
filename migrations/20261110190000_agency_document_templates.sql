-- Imported document templates of the agency (owner request 2026-11-10):
-- staff import a Word or text file on the documents page, check its
-- variables, preview it and activate it; an active template is offered in
-- "generate from template" next to the built-in ones.
--
-- One row is one version. A re-import into the same family adds a version;
-- only one version of a family is active. The text of an activated version
-- never changes, so a generated document keeps pointing at what it was made
-- from (`documents.ursprung = 'template:agency_template:<id>'`).
CREATE TABLE agency_document_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id UUID NOT NULL,
    version_number INTEGER NOT NULL CHECK (version_number >= 1),
    label TEXT NOT NULL CHECK (btrim(label) <> ''),
    description TEXT NULL,
    language TEXT NOT NULL CHECK (language IN ('de', 'en', 'uk', 'ru')),
    body TEXT NOT NULL CHECK (btrim(body) <> ''),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'disabled')),
    source_filename TEXT NULL,
    source_sha256 TEXT NULL,
    created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    activated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    activated_at TIMESTAMPTZ NULL,
    disabled_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    disabled_at TIMESTAMPTZ NULL,
    UNIQUE (family_id, version_number)
);

CREATE UNIQUE INDEX idx_agency_document_templates_one_active
    ON agency_document_templates(family_id)
    WHERE status = 'active';

CREATE INDEX idx_agency_document_templates_status
    ON agency_document_templates(status, label);
