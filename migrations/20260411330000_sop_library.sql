CREATE TABLE IF NOT EXISTS sop_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('sop', 'handbook', 'training')),
    summary TEXT,
    body_markdown TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected', 'archived')),
    target_roles TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    requires_ack BOOLEAN NOT NULL DEFAULT false,
    revision_no INTEGER NOT NULL DEFAULT 1 CHECK (revision_no >= 1),
    created_by UUID NOT NULL REFERENCES users(id),
    created_by_role TEXT NOT NULL,
    approval_required_role TEXT,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    review_note TEXT,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sop_documents_status ON sop_documents(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sop_documents_creator ON sop_documents(created_by, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sop_documents_target_roles ON sop_documents USING GIN (target_roles);

CREATE TABLE IF NOT EXISTS sop_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sop_id UUID NOT NULL REFERENCES sop_documents(id) ON DELETE CASCADE,
    target_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (sop_id, target_user_id)
);

CREATE INDEX IF NOT EXISTS idx_sop_assignments_user ON sop_assignments(target_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sop_acknowledgements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sop_id UUID NOT NULL REFERENCES sop_documents(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
    status TEXT NOT NULL CHECK (status IN ('pending', 'acknowledged')),
    requested_by UUID NOT NULL REFERENCES users(id),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at TIMESTAMPTZ,
    UNIQUE (sop_id, user_id, revision_no)
);

CREATE INDEX IF NOT EXISTS idx_sop_ack_user ON sop_acknowledgements(user_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_sop_ack_sop ON sop_acknowledgements(sop_id, revision_no, status);
