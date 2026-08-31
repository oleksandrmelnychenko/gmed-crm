CREATE TABLE crm_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 255),
    description TEXT,
    status TEXT NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'active', 'on_hold', 'completed', 'cancelled')),
    priority TEXT NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    owner_id UUID NOT NULL REFERENCES users(id),
    patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
    starts_on DATE,
    due_on DATE,
    created_by UUID NOT NULL REFERENCES users(id),
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (due_on IS NULL OR starts_on IS NULL OR due_on >= starts_on)
);

CREATE TABLE crm_project_members (
    project_id UUID NOT NULL REFERENCES crm_projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    member_role TEXT NOT NULL DEFAULT 'member'
        CHECK (member_role IN ('manager', 'member')),
    added_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);

ALTER TABLE tasks
    ADD COLUMN project_id UUID REFERENCES crm_projects(id) ON DELETE SET NULL;

CREATE INDEX idx_crm_projects_owner_status
    ON crm_projects(owner_id, status)
    WHERE archived_at IS NULL;
CREATE INDEX idx_crm_projects_patient
    ON crm_projects(patient_id)
    WHERE patient_id IS NOT NULL AND archived_at IS NULL;
CREATE INDEX idx_crm_project_members_user
    ON crm_project_members(user_id, project_id);
CREATE INDEX idx_tasks_project
    ON tasks(project_id, status)
    WHERE project_id IS NOT NULL AND deleted_at IS NULL;
