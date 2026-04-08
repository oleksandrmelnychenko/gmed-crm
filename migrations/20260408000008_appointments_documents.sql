CREATE TABLE appointments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id),
    provider_id UUID REFERENCES providers(id),
    order_id UUID REFERENCES orders(id),
    interpreter_id UUID REFERENCES users(id),
    appointment_type TEXT NOT NULL CHECK (appointment_type IN ('medical', 'non_medical', 'internal')),
    title TEXT NOT NULL,
    date DATE NOT NULL,
    time_start TIME,
    time_end TIME,
    location TEXT,
    category TEXT,
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'confirmed', 'in_progress', 'completed', 'cancelled')),
    interpreter_response TEXT CHECK (interpreter_response IS NULL OR interpreter_response IN ('pending', 'accepted', 'declined', 'discussion_requested')),
    checklist_phase TEXT NOT NULL DEFAULT 'preparation' CHECK (checklist_phase IN ('preparation', 'execution', 'followup', 'done')),
    preparation_notes TEXT,
    followup_notes TEXT,
    notes TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_apt_patient ON appointments(patient_id);
CREATE INDEX idx_apt_provider ON appointments(provider_id);
CREATE INDEX idx_apt_order ON appointments(order_id);
CREATE INDEX idx_apt_interpreter ON appointments(interpreter_id);
CREATE INDEX idx_apt_date ON appointments(date);
CREATE INDEX idx_apt_status ON appointments(status);

CREATE TRIGGER set_updated_at_apt
    BEFORE UPDATE ON appointments
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE appointment_checklists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    phase TEXT NOT NULL CHECK (phase IN ('preparation', 'execution', 'followup')),
    item_text TEXT NOT NULL,
    is_completed BOOLEAN NOT NULL DEFAULT false,
    completed_by UUID REFERENCES users(id),
    completed_at TIMESTAMPTZ,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_acl_apt ON appointment_checklists(appointment_id);

CREATE TABLE reminders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    appointment_id UUID REFERENCES appointments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    remind_at TIMESTAMPTZ NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    is_completed BOOLEAN NOT NULL DEFAULT false,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rem_user ON reminders(user_id);
CREATE INDEX idx_rem_date ON reminders(remind_at) WHERE NOT is_completed;

CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id),
    order_id UUID REFERENCES orders(id),
    appointment_id UUID REFERENCES appointments(id),
    auto_name TEXT NOT NULL,
    original_filename TEXT,
    art TEXT NOT NULL,
    category TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
    visibility TEXT NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal', 'released_internal', 'released_external', 'patient_visible')),
    is_medical BOOLEAN NOT NULL DEFAULT false,
    mime_type TEXT,
    file_size BIGINT,
    storage_key TEXT,
    klinik TEXT,
    ursprung TEXT,
    notes TEXT,
    uploaded_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_doc_patient ON documents(patient_id);
CREATE INDEX idx_doc_order ON documents(order_id);
CREATE INDEX idx_doc_visibility ON documents(visibility);
CREATE INDEX idx_doc_art ON documents(art);

CREATE TRIGGER set_updated_at_doc
    BEFORE UPDATE ON documents
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE document_shares (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    shared_with_provider_id UUID REFERENCES providers(id),
    shared_with_user_id UUID REFERENCES users(id),
    shared_by UUID NOT NULL REFERENCES users(id),
    channel TEXT,
    requires_confirmation BOOLEAN NOT NULL DEFAULT false,
    confirmed BOOLEAN NOT NULL DEFAULT false,
    confirmed_at TIMESTAMPTZ,
    shared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_ds_doc ON document_shares(document_id);

CREATE TABLE interpreter_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    interpreter_id UUID NOT NULL REFERENCES users(id),
    hours NUMERIC NOT NULL,
    report_text TEXT,
    approval_status TEXT NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ir_apt ON interpreter_reports(appointment_id);
CREATE INDEX idx_ir_interpreter ON interpreter_reports(interpreter_id);
CREATE INDEX idx_ir_status ON interpreter_reports(approval_status);

CREATE TRIGGER set_updated_at_ir
    BEFORE UPDATE ON interpreter_reports
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    description TEXT,
    assigned_to UUID NOT NULL REFERENCES users(id),
    assigned_by UUID NOT NULL REFERENCES users(id),
    patient_id UUID REFERENCES patients(id),
    order_id UUID REFERENCES orders(id),
    appointment_id UUID REFERENCES appointments(id),
    due_date TIMESTAMPTZ,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_assigned ON tasks(assigned_to);
CREATE INDEX idx_tasks_status ON tasks(status) WHERE status != 'completed';
CREATE INDEX idx_tasks_due ON tasks(due_date) WHERE status != 'completed';

CREATE TRIGGER set_updated_at_tasks
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();
