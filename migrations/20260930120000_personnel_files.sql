-- Personnel files (Personalakte / Entgeltunterlagen), § 8 BVV: from
-- 01.01.2027 every document that proves employment and social insurance is
-- kept digitally, unchanged, promptly and under a self-explaining name.
-- See docs/personnel-files-plan-2026-09-30_ua.md.
--
-- * personnel_documents is an append-only archive. Content, name, dates and
--   author never change; a correction is a new version that points at the
--   one it supersedes. Each employee's documents form a hash chain, so a row
--   removed or rewritten behind the triggers breaks the chain.
-- * A document past its retention period is not deleted: its blob is removed
--   and the row stays as a tombstone that keeps the chain verifiable.
-- * personnel_document_events is the file's own append-only journal; it is
--   kept as long as the documents, unlike the 365-day business audit log.

-- ---------------------------------------------------------------------------
-- Categories and retention
-- ---------------------------------------------------------------------------
CREATE TABLE personnel_document_categories (
    code TEXT PRIMARY KEY CHECK (code ~ '^[a-z_]+$'),
    -- German label used in archive file names (transliterated there).
    file_label TEXT NOT NULL CHECK (btrim(file_label) <> ''),
    -- Monthly documents carry a period (month), the others a document date.
    monthly BOOLEAN NOT NULL,
    -- Health data (sick notes) needs `personnel.health.view`.
    is_health BOOLEAN NOT NULL DEFAULT false,
    -- Expected every month for every active employee (completeness matrix).
    expected_monthly BOOLEAN NOT NULL DEFAULT false,
    retention_years INTEGER NOT NULL CHECK (retention_years BETWEEN 1 AND 50),
    -- The retention clock starts at the end of the year of the document, or
    -- at the end of the year the employment ended.
    retention_from TEXT NOT NULL CHECK (retention_from IN ('document', 'employment_end')),
    legal_basis TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Proposal from the plan (section 3.8); the payroll office confirms it.
-- Deletion stays disabled until then (personnel_retention_deletion_enabled).
INSERT INTO personnel_document_categories
    (code, file_label, monthly, is_health, expected_monthly, retention_years, retention_from, legal_basis, sort_order)
VALUES
    ('arbeitsvertrag', 'Arbeitsvertrag', false, false, false, 6, 'employment_end', '§ 257 HGB, § 195 BGB', 10),
    ('vertragsaenderung', 'Vertragsaenderung', false, false, false, 6, 'employment_end', '§ 257 HGB, § 195 BGB', 20),
    ('nachweis', 'Nachweis', false, false, false, 6, 'employment_end', 'NachwG, § 195 BGB', 30),
    ('stundenzettel', 'Stundenzettel', true, false, true, 6, 'document', '§ 28f SGB IV, § 17 MiLoG', 40),
    ('entgeltabrechnung', 'Entgeltabrechnung', true, false, true, 8, 'document', '§ 147 AO', 50),
    ('lohnsteuer', 'Lohnsteuer', false, false, false, 6, 'document', '§ 41 EStG', 60),
    ('sozialversicherung', 'Sozialversicherung', false, false, false, 6, 'document', '§ 28f SGB IV', 70),
    ('arbeitsunfaehigkeit', 'Arbeitsunfaehigkeit', false, true, false, 3, 'document', 'EFZG; Art. 5 Abs. 1 lit. e DSGVO', 80),
    ('urlaub', 'Urlaub', false, false, false, 3, 'employment_end', '§ 195 BGB', 90),
    ('abmahnung', 'Abmahnung', false, false, false, 3, 'document', 'BAG-Rechtsprechung', 100),
    ('kuendigung', 'Kuendigung', false, false, false, 6, 'employment_end', '§ 257 HGB, § 195 BGB', 110),
    ('zeugnis', 'Zeugnis', false, false, false, 3, 'employment_end', '§ 195 BGB', 120),
    ('schriftverkehr', 'Schriftverkehr', false, false, false, 3, 'employment_end', '§ 195 BGB', 130),
    ('sonstiges', 'Sonstiges', false, false, false, 3, 'employment_end', '§ 195 BGB', 140);

INSERT INTO system_settings (key, value, description) VALUES
    ('personnel_late_days', '7',
     'Days after the end of a month (or after the document date) before a personnel document counts as archived late'),
    ('personnel_retention_deletion_enabled', 'false',
     'Whether personnel documents past their retention period may be deleted; stays false until the payroll office confirms the retention periods'),
    ('personnel_tsa_url', '""',
     'RFC 3161 time-stamping authority URL for the daily personnel archive anchor; empty disables time stamps')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Employees
-- ---------------------------------------------------------------------------
CREATE TABLE employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Optional login: the employee may open their own file.
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL,
    salutation TEXT NOT NULL DEFAULT 'none' CHECK (salutation IN ('frau', 'herr', 'none')),
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL CHECK (btrim(last_name) <> ''),
    -- DATEV Personalnummer; social security numbers stay in DATEV.
    personnel_number TEXT,
    employment_start DATE,
    employment_end DATE,
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT employees_employment_order CHECK (
        employment_start IS NULL OR employment_end IS NULL OR employment_end >= employment_start
    )
);

CREATE UNIQUE INDEX uq_employees_personnel_number
    ON employees (personnel_number)
    WHERE personnel_number IS NOT NULL;

CREATE INDEX idx_employees_name ON employees (lower(last_name), lower(first_name));

CREATE TRIGGER set_updated_at_employees
BEFORE UPDATE ON employees
FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- An employee with documents is never deleted; the file is kept for its
-- retention period.
CREATE OR REPLACE FUNCTION employees_keep_files()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM personnel_documents WHERE employee_id = OLD.id) THEN
        RAISE EXCEPTION 'An employee with personnel documents cannot be deleted'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
END;
$$;

-- ---------------------------------------------------------------------------
-- Archive
-- ---------------------------------------------------------------------------
CREATE TABLE personnel_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    category TEXT NOT NULL REFERENCES personnel_document_categories(code),
    -- First day of the month for monthly documents.
    period_month DATE CHECK (period_month IS NULL OR extract(day FROM period_month) = 1),
    document_date DATE,
    title TEXT,
    archive_file_name TEXT NOT NULL CHECK (
        length(archive_file_name) <= 64
        AND archive_file_name ~ '^[A-Za-z0-9][A-Za-z0-9_]*[A-Za-z0-9]\.(pdf|jpg|png|bmp|tif)$'
    ),
    original_file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL CHECK (
        mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/bmp', 'image/tiff')
    ),
    file_size BIGINT NOT NULL CHECK (file_size > 0),
    sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    storage_key TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL CHECK (source IN ('upload', 'scan', 'import')),
    -- For `import`: the interpreter profile document the file was copied from.
    source_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    -- When the paper or file reached the company (scan intake), if earlier
    -- than the archiving.
    received_at TIMESTAMPTZ,
    version_root_id UUID NOT NULL,
    supersedes_id UUID UNIQUE REFERENCES personnel_documents(id),
    version_number INTEGER NOT NULL CHECK (version_number >= 1),
    correction_reason TEXT,
    -- Set by the database, never by the client.
    archived_at TIMESTAMPTZ NOT NULL,
    archived_by UUID NOT NULL REFERENCES users(id),
    chain_seq BIGINT NOT NULL,
    prev_chain_hash TEXT NOT NULL CHECK (prev_chain_hash ~ '^[0-9a-f]{64}$'),
    chain_hash TEXT NOT NULL UNIQUE CHECK (chain_hash ~ '^[0-9a-f]{64}$'),
    legal_hold BOOLEAN NOT NULL DEFAULT false,
    -- Tombstone after the retention period: the blob is gone, the row stays.
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES users(id),
    delete_reason TEXT,
    CONSTRAINT personnel_documents_period_shape CHECK (
        (period_month IS NOT NULL AND document_date IS NULL)
        OR (period_month IS NULL AND document_date IS NOT NULL)
    ),
    CONSTRAINT personnel_documents_version_shape CHECK (
        (supersedes_id IS NULL AND version_number = 1 AND version_root_id = id AND correction_reason IS NULL)
        OR (supersedes_id IS NOT NULL AND version_number > 1
            AND correction_reason IS NOT NULL AND btrim(correction_reason) <> '')
    ),
    CONSTRAINT personnel_documents_tombstone_shape CHECK (
        (deleted_at IS NULL AND deleted_by IS NULL AND delete_reason IS NULL)
        OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL
            AND delete_reason IS NOT NULL AND btrim(delete_reason) <> '')
    ),
    UNIQUE (employee_id, chain_seq)
);

CREATE INDEX idx_personnel_documents_employee
    ON personnel_documents (employee_id, category, period_month, document_date);
CREATE INDEX idx_personnel_documents_archived ON personnel_documents (archived_at);
CREATE INDEX idx_personnel_documents_root ON personnel_documents (version_root_id, version_number);
CREATE UNIQUE INDEX uq_personnel_documents_name
    ON personnel_documents (employee_id, archive_file_name);
-- A profile document is imported into a file once.
CREATE UNIQUE INDEX uq_personnel_documents_source
    ON personnel_documents (employee_id, source_document_id)
    WHERE source_document_id IS NOT NULL;

CREATE TRIGGER employees_keep_files
BEFORE DELETE ON employees
FOR EACH ROW EXECUTE FUNCTION employees_keep_files();

-- The chain link of one document. The Rust verifier recomputes the same
-- string (crates/server/src/routes/personnel/integrity.rs).
CREATE OR REPLACE FUNCTION personnel_chain_hash(
    p_prev TEXT,
    p_id UUID,
    p_employee_id UUID,
    p_seq BIGINT,
    p_sha256 TEXT,
    p_category TEXT,
    p_archive_file_name TEXT,
    p_archived_at TIMESTAMPTZ
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT encode(sha256(convert_to(
        p_prev || '|' || p_id::text || '|' || p_employee_id::text || '|' || p_seq::text
        || '|' || p_sha256 || '|' || p_category || '|' || p_archive_file_name
        || '|' || to_char(p_archived_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'UTF8')), 'hex')
$$;

-- Stamps the archive time and links the row into the employee's chain.
-- Serialised per employee by locking the employee row.
CREATE OR REPLACE FUNCTION personnel_documents_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_prev TEXT;
    v_seq BIGINT;
    v_superseded personnel_documents%ROWTYPE;
BEGIN
    PERFORM 1 FROM employees WHERE id = NEW.employee_id FOR UPDATE;

    IF NEW.supersedes_id IS NOT NULL THEN
        SELECT * INTO v_superseded FROM personnel_documents WHERE id = NEW.supersedes_id;
        IF NOT FOUND OR v_superseded.employee_id <> NEW.employee_id THEN
            RAISE EXCEPTION 'The superseded document belongs to another file'
                USING ERRCODE = 'P0001';
        END IF;
        IF v_superseded.deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'A deleted document cannot get a new version'
                USING ERRCODE = 'P0001';
        END IF;
        NEW.version_root_id := v_superseded.version_root_id;
        NEW.version_number := v_superseded.version_number + 1;
    ELSE
        NEW.version_root_id := NEW.id;
        NEW.version_number := 1;
    END IF;

    NEW.archived_at := clock_timestamp();
    NEW.legal_hold := false;
    NEW.deleted_at := NULL;
    NEW.deleted_by := NULL;
    NEW.delete_reason := NULL;

    SELECT chain_hash, chain_seq INTO v_prev, v_seq
    FROM personnel_documents
    WHERE employee_id = NEW.employee_id
    ORDER BY chain_seq DESC
    LIMIT 1;
    NEW.prev_chain_hash := COALESCE(v_prev, repeat('0', 64));
    NEW.chain_seq := COALESCE(v_seq, 0) + 1;
    NEW.chain_hash := personnel_chain_hash(
        NEW.prev_chain_hash, NEW.id, NEW.employee_id, NEW.chain_seq, NEW.sha256,
        NEW.category, NEW.archive_file_name, NEW.archived_at
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER personnel_documents_before_insert
BEFORE INSERT ON personnel_documents
FOR EACH ROW EXECUTE FUNCTION personnel_documents_before_insert();

-- The retention end of one document, or NULL while it cannot be known yet
-- (the employment has not ended).
CREATE OR REPLACE FUNCTION personnel_retention_until(
    p_category TEXT,
    p_period_month DATE,
    p_document_date DATE,
    p_employment_end DATE
) RETURNS DATE
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN c.retention_from = 'document' THEN
            make_date(extract(year FROM COALESCE(p_period_month, p_document_date))::int + c.retention_years, 12, 31)
        WHEN p_employment_end IS NULL THEN NULL
        ELSE make_date(extract(year FROM p_employment_end)::int + c.retention_years, 12, 31)
    END
    FROM personnel_document_categories c
    WHERE c.code = p_category
$$;

-- Nothing in an archived document changes. Only the legal hold may be
-- toggled, and a document past its retention period (deletion enabled, no
-- legal hold, newest version or superseded alike) may become a tombstone.
-- Rows are never deleted.
CREATE OR REPLACE FUNCTION personnel_documents_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_until DATE;
    v_enabled BOOLEAN;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Personnel documents cannot be deleted'
            USING ERRCODE = 'P0001';
    END IF;
    IF (NEW.id, NEW.employee_id, NEW.category, NEW.period_month, NEW.document_date,
        NEW.title, NEW.archive_file_name, NEW.original_file_name, NEW.mime_type,
        NEW.file_size, NEW.sha256, NEW.storage_key, NEW.source, NEW.received_at,
        NEW.source_document_id IS NOT DISTINCT FROM OLD.source_document_id
            OR (OLD.source_document_id IS NOT NULL AND NEW.source_document_id IS NULL),
        NEW.version_root_id, NEW.supersedes_id, NEW.version_number,
        NEW.correction_reason, NEW.archived_at, NEW.archived_by, NEW.chain_seq,
        NEW.prev_chain_hash, NEW.chain_hash)
       IS DISTINCT FROM
       (OLD.id, OLD.employee_id, OLD.category, OLD.period_month, OLD.document_date,
        OLD.title, OLD.archive_file_name, OLD.original_file_name, OLD.mime_type,
        OLD.file_size, OLD.sha256, OLD.storage_key, OLD.source, OLD.received_at,
        true,
        OLD.version_root_id, OLD.supersedes_id, OLD.version_number,
        OLD.correction_reason, OLD.archived_at, OLD.archived_by, OLD.chain_seq,
        OLD.prev_chain_hash, OLD.chain_hash) THEN
        RAISE EXCEPTION 'Archived personnel documents cannot be changed'
            USING ERRCODE = 'P0001';
    END IF;
    IF OLD.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'A deleted personnel document cannot be changed'
            USING ERRCODE = 'P0001';
    END IF;
    IF NEW.deleted_at IS NOT NULL THEN
        IF NEW.legal_hold THEN
            RAISE EXCEPTION 'A personnel document under legal hold cannot be deleted'
                USING ERRCODE = 'P0001';
        END IF;
        SELECT COALESCE(value::text IN ('true', '"true"'), false) INTO v_enabled
        FROM system_settings WHERE key = 'personnel_retention_deletion_enabled';
        IF NOT COALESCE(v_enabled, false) THEN
            RAISE EXCEPTION 'Deleting personnel documents is disabled'
                USING ERRCODE = 'P0001';
        END IF;
        SELECT personnel_retention_until(NEW.category, NEW.period_month, NEW.document_date, e.employment_end)
        INTO v_until
        FROM employees e WHERE e.id = NEW.employee_id;
        IF v_until IS NULL OR v_until >= current_date THEN
            RAISE EXCEPTION 'The retention period of this personnel document has not ended'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER personnel_documents_immutable
BEFORE UPDATE OR DELETE ON personnel_documents
FOR EACH ROW EXECUTE FUNCTION personnel_documents_immutable();

-- ---------------------------------------------------------------------------
-- Journal
-- ---------------------------------------------------------------------------
CREATE TABLE personnel_document_events (
    id BIGSERIAL PRIMARY KEY,
    employee_id UUID REFERENCES employees(id) ON DELETE RESTRICT,
    document_id UUID REFERENCES personnel_documents(id) ON DELETE RESTRICT,
    actor_id UUID REFERENCES users(id),
    action TEXT NOT NULL CHECK (action IN (
        'employee_created', 'employee_updated', 'document_archived',
        'document_version', 'document_downloaded', 'own_file_viewed',
        'own_document_downloaded', 'legal_hold_set', 'legal_hold_released',
        'document_deleted', 'export_created', 'intake_received',
        'intake_discarded', 'integrity_failed', 'category_updated',
        'settings_updated'
    )),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_personnel_document_events_employee
    ON personnel_document_events (employee_id, created_at DESC);
CREATE INDEX idx_personnel_document_events_document
    ON personnel_document_events (document_id, created_at DESC);

CREATE OR REPLACE FUNCTION personnel_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
        USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER personnel_document_events_append_only
BEFORE UPDATE OR DELETE ON personnel_document_events
FOR EACH ROW EXECUTE FUNCTION personnel_append_only();

-- ---------------------------------------------------------------------------
-- Scan intake: scanned or uploaded files that are not archived yet. The
-- archive time starts when the file is assigned to an employee; the intake
-- time is kept as `received_at`.
-- ---------------------------------------------------------------------------
CREATE TABLE personnel_intake_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    storage_key TEXT NOT NULL UNIQUE,
    original_file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL CHECK (
        mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/bmp', 'image/tiff')
    ),
    file_size BIGINT NOT NULL CHECK (file_size > 0),
    sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    source TEXT NOT NULL CHECK (source IN ('upload', 'scan')),
    uploaded_by UUID NOT NULL REFERENCES users(id),
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'archived', 'discarded')),
    document_id UUID REFERENCES personnel_documents(id),
    resolved_by UUID REFERENCES users(id),
    resolved_at TIMESTAMPTZ,
    CONSTRAINT personnel_intake_items_resolution CHECK (
        (status = 'pending' AND document_id IS NULL AND resolved_at IS NULL)
        OR (status = 'archived' AND document_id IS NOT NULL AND resolved_at IS NOT NULL)
        OR (status = 'discarded' AND document_id IS NULL AND resolved_at IS NOT NULL)
    )
);

CREATE INDEX idx_personnel_intake_items_pending
    ON personnel_intake_items (received_at)
    WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Integrity: daily anchors (RFC 3161 time stamps) and verification runs
-- ---------------------------------------------------------------------------
CREATE TABLE personnel_chain_anchors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    anchor_date DATE NOT NULL UNIQUE,
    -- sha256 over the sorted "employee_id:chain_seq:chain_hash" lines.
    anchor_hash TEXT NOT NULL CHECK (anchor_hash ~ '^[0-9a-f]{64}$'),
    -- The lines themselves, so the anchor can be recomputed later.
    heads JSONB NOT NULL,
    employee_count INTEGER NOT NULL,
    document_count BIGINT NOT NULL,
    tsa_status TEXT NOT NULL CHECK (tsa_status IN ('pending', 'stamped', 'failed', 'disabled')),
    tsa_url TEXT,
    tsa_token BYTEA,
    tsa_gen_time TIMESTAMPTZ,
    tsa_attempts INTEGER NOT NULL DEFAULT 0,
    tsa_last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The anchor itself never changes; only a pending time stamp may be filled
-- in (or retried) once.
CREATE OR REPLACE FUNCTION personnel_chain_anchors_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'personnel_chain_anchors is append-only'
            USING ERRCODE = 'P0001';
    END IF;
    IF (NEW.id, NEW.anchor_date, NEW.anchor_hash, NEW.heads, NEW.employee_count,
        NEW.document_count, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.anchor_date, OLD.anchor_hash, OLD.heads, OLD.employee_count,
        OLD.document_count, OLD.created_at)
       OR OLD.tsa_status = 'stamped' THEN
        RAISE EXCEPTION 'A personnel chain anchor cannot be changed'
            USING ERRCODE = 'P0001';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER personnel_chain_anchors_immutable
BEFORE UPDATE OR DELETE ON personnel_chain_anchors
FOR EACH ROW EXECUTE FUNCTION personnel_chain_anchors_immutable();

CREATE TABLE personnel_integrity_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_trigger TEXT NOT NULL CHECK (run_trigger IN ('scheduled', 'manual')),
    started_by UUID REFERENCES users(id),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    employees_checked INTEGER NOT NULL DEFAULT 0,
    documents_checked BIGINT NOT NULL DEFAULT 0,
    failures JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'passed', 'failed', 'error'))
);

CREATE INDEX idx_personnel_integrity_runs_started ON personnel_integrity_runs (started_at DESC);
