-- Versioned provenance for Medication Intelligence official open sources.
--
-- This migration intentionally does not enable a network connector. A source
-- is `active` only after its official machine-readable contract and permanent
-- URL have been reviewed and an operator enables a worker explicitly.

CREATE TABLE medication_intelligence_sources (
    id TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9_]+$'),
    label TEXT NOT NULL CHECK (btrim(label) <> ''),
    authority TEXT NOT NULL CHECK (btrim(authority) <> ''),
    kind TEXT NOT NULL CHECK (btrim(kind) <> ''),
    source_url TEXT NOT NULL CHECK (source_url ~ '^https://'),
    machine_readable BOOLEAN NOT NULL,
    connector_status TEXT NOT NULL CHECK (
        connector_status IN ('planned', 'manual_reference', 'active', 'disabled')
    ),
    freshness_ttl_hours INTEGER CHECK (freshness_ttl_hours > 0),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (connector_status <> 'active' OR machine_readable = true)
);

CREATE TRIGGER set_updated_at_medication_intelligence_sources
    BEFORE UPDATE ON medication_intelligence_sources
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE medication_intelligence_ingestion_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL REFERENCES medication_intelligence_sources(id) ON DELETE RESTRICT,
    idempotency_key TEXT NOT NULL CHECK (
        btrim(idempotency_key) <> '' AND length(idempotency_key) <= 200
    ),
    status TEXT NOT NULL DEFAULT 'queued' CHECK (
        status IN ('queued', 'running', 'succeeded', 'failed', 'skipped')
    ),
    requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
    source_url TEXT NOT NULL CHECK (source_url ~ '^https://'),
    worker_id TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_code TEXT,
    error_message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_id, idempotency_key),
    CHECK (status <> 'running' OR started_at IS NOT NULL),
    CHECK (status NOT IN ('succeeded', 'failed', 'skipped') OR completed_at IS NOT NULL),
    CHECK (status <> 'failed' OR error_message IS NOT NULL),
    CHECK (error_code IS NULL OR error_code ~ '^[a-z0-9_]{1,64}$')
);

CREATE INDEX idx_medication_intelligence_ingestion_jobs_queue
    ON medication_intelligence_ingestion_jobs(status, requested_at, id)
    WHERE status = 'queued';

CREATE INDEX idx_medication_intelligence_ingestion_jobs_source_attempt
    ON medication_intelligence_ingestion_jobs(source_id, completed_at DESC, requested_at DESC);

CREATE TRIGGER set_updated_at_medication_intelligence_ingestion_jobs
    BEFORE UPDATE ON medication_intelligence_ingestion_jobs
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- A snapshot row is the immutable result of one fetch attempt. Successful
-- attempts carry a checksum; failed attempts retain source URL, error and
-- metadata without pretending that usable source data was produced.
CREATE TABLE medication_intelligence_source_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL REFERENCES medication_intelligence_sources(id) ON DELETE RESTRICT,
    ingestion_job_id UUID NOT NULL UNIQUE
        REFERENCES medication_intelligence_ingestion_jobs(id) ON DELETE RESTRICT,
    attempt_status TEXT NOT NULL CHECK (attempt_status IN ('success', 'failed')),
    fetched_at TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ,
    source_url TEXT NOT NULL CHECK (source_url ~ '^https://'),
    checksum_sha256 TEXT,
    source_version TEXT,
    item_count BIGINT CHECK (item_count IS NULL OR item_count >= 0),
    content_type TEXT,
    byte_length BIGINT CHECK (byte_length IS NULL OR byte_length >= 0),
    payload_storage_key TEXT,
    error_code TEXT,
    error_message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (error_code IS NULL OR error_code ~ '^[a-z0-9_]{1,64}$'),
    CHECK (
        (attempt_status = 'success'
            AND checksum_sha256 ~ '^[0-9a-f]{64}$'
            AND byte_length IS NOT NULL
            AND error_message IS NULL)
        OR
        (attempt_status = 'failed'
            AND checksum_sha256 IS NULL
            AND error_message IS NOT NULL)
    )
);

CREATE UNIQUE INDEX uq_medication_intelligence_successful_source_checksum
    ON medication_intelligence_source_snapshots(source_id, checksum_sha256)
    WHERE attempt_status = 'success';

CREATE INDEX idx_medication_intelligence_source_snapshots_latest_success
    ON medication_intelligence_source_snapshots(source_id, fetched_at DESC, id DESC)
    WHERE attempt_status = 'success';

ALTER TABLE medication_intelligence_ingestion_jobs
    ADD COLUMN result_snapshot_id UUID
        REFERENCES medication_intelligence_source_snapshots(id) ON DELETE RESTRICT,
    ADD CONSTRAINT medication_intelligence_terminal_job_snapshot_check CHECK (
        status NOT IN ('succeeded', 'failed', 'skipped')
        OR result_snapshot_id IS NOT NULL
    );

CREATE OR REPLACE FUNCTION prevent_medication_intelligence_snapshot_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'medication_intelligence_source_snapshots is immutable; append a new attempt instead';
END;
$$;

CREATE TRIGGER prevent_medication_intelligence_snapshot_mutation
    BEFORE UPDATE OR DELETE ON medication_intelligence_source_snapshots
    FOR EACH ROW
    EXECUTE FUNCTION prevent_medication_intelligence_snapshot_mutation();

INSERT INTO medication_intelligence_sources (
    id, label, authority, kind, source_url, machine_readable,
    connector_status, freshness_ttl_hours, metadata
)
VALUES
    (
        'ema_pms_public_api',
        'EMA Product Management Service Public API',
        'European Medicines Agency (EMA)',
        'medicinal_product_registry_api',
        'https://api.pms.ema.europa.eu/public/v1/swagger',
        true, 'planned', 168,
        '{"activation_note":"Public OpenAPI is documented; medicinal-product identity mapping remains a separately reviewed connector."}'::jsonb
    ),
    (
        'bfarm_pharmnet_amice',
        'PharmNet.Bund Arzneimittel-Informationssystem (AMIce)',
        'BfArM / PharmNet.Bund',
        'german_medicinal_product_registry',
        'https://www.pharmnet-bund.de/dynamic/de/arzneimittel-informationssystem/index.html',
        false, 'manual_reference', NULL,
        '{"activation_note":"No reviewed public bulk/API contract is configured."}'::jsonb
    ),
    (
        'bfarm_rote_hand',
        'Rote-Hand-Briefe und RSS',
        'Bundesinstitut für Arzneimittel und Medizinprodukte (BfArM)',
        'safety_alerts_rss',
        'https://www.bfarm.de/DE/Arzneimittel/Pharmakovigilanz/Risikoinformationen/Rote-Hand-Briefe/_node.html',
        true, 'planned', 24,
        '{"activation_note":"Official RSS is described, but a successful production fetch has not been verified."}'::jsonb
    ),
    (
        'bfarm_lieferengpaesse',
        'Lieferengpassmeldungen',
        'Bundesinstitut für Arzneimittel und Medizinprodukte (BfArM)',
        'shortage_registry',
        'https://anwendungen.pharmnet-bund.de/lieferengpassmeldungen/faces/public/meldungen.xhtml',
        true, 'planned', 24,
        '{"activation_note":"Machine-readable ingestion endpoint and format require separate review."}'::jsonb
    ),
    (
        'pei_sicherheitsinformationen',
        'Sicherheitsinformationen zu Arzneimitteln',
        'Paul-Ehrlich-Institut (PEI)',
        'safety_information',
        'https://www.pei.de/DE/newsroom/veroffentlichungen-arzneimittel/sicherheitsinformationen/sicherheitsinformationen-node.html',
        false, 'manual_reference', NULL, '{}'::jsonb
    ),
    (
        'gba_ais_xml',
        'Arzneimittel-Informationssystem (AIS)',
        'Gemeinsamer Bundesausschuss (G-BA)',
        'benefit_assessment_xml',
        'https://www.g-ba.de/themen/arzneimittel/arzneimittel-richtlinie-anlagen/nutzenbewertung-35a/ais/',
        true, 'planned', 384,
        '{"activation_note":"A permanent automated XML URL requires acceptance of the G-BA terms and an operator-provided configured URL."}'::jsonb
    ),
    (
        'awmf_leitlinienregister',
        'AWMF-Leitlinienregister',
        'Arbeitsgemeinschaft der Wissenschaftlichen Medizinischen Fachgesellschaften (AWMF)',
        'clinical_guidelines',
        'https://register.awmf.org/de/start',
        false, 'manual_reference', NULL, '{}'::jsonb
    ),
    (
        'nvl',
        'Nationale VersorgungsLeitlinien',
        'AWMF / Zentralinstitut für die kassenärztliche Versorgung (Zi)',
        'national_care_guidelines',
        'https://www.leitlinien.de/',
        false, 'manual_reference', NULL, '{}'::jsonb
    ),
    (
        'kbv_bmp',
        'Bundeseinheitlicher Medikationsplan (BMP)',
        'Kassenärztliche Bundesvereinigung (KBV)',
        'medication_plan_standard',
        'https://www.kbv.de/praxis/verordnungen/arzneimittel/medikationsplan',
        false, 'manual_reference', NULL, '{}'::jsonb
    );
