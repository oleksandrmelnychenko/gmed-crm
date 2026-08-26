-- First live Medication Intelligence official-source connector.
--
-- The RSS URL below is the exact root-relative link published by the BfArM
-- Rote-Hand-Briefe page. The worker never accepts a request-supplied URL and
-- never follows redirects. RSS descriptions are intentionally not normalized
-- or exposed; the item table stores only minimal provenance and explicitly
-- extractable Wirkstoff labels.

UPDATE medication_intelligence_sources
SET source_url = 'https://www.bfarm.de/SiteGlobals/Functions/RSSFeed/DE/Pharmakovigilanz/Rote-Hand-Briefe/RSSNewsfeed.xml?nn=591002',
    connector_status = 'active',
    freshness_ttl_hours = 3,
    metadata = jsonb_build_object(
        'contract', 'rss_2_0',
        'activation_note', 'Exact official BfArM RSS href verified with a bounded HTTP 200 fetch on 2026-08-26.',
        'copyright_policy', 'Store the bounded source snapshot for audit; expose only title, publication date, official link and explicit Wirkstoff evidence.',
        'schedule_minutes', 60,
        'worker_poll_seconds', 60,
        'claim_lease_minutes', 10
    )
WHERE id = 'bfarm_rote_hand';

-- Internal, immutable raw payloads make every normalized row reproducible.
-- There is deliberately no API route for this table.
CREATE TABLE medication_intelligence_source_payloads (
    snapshot_id UUID PRIMARY KEY
        REFERENCES medication_intelligence_source_snapshots(id) ON DELETE RESTRICT,
    source_id TEXT NOT NULL
        REFERENCES medication_intelligence_sources(id) ON DELETE RESTRICT,
    content_type TEXT NOT NULL CHECK (btrim(content_type) <> ''),
    checksum_sha256 TEXT NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
    payload BYTEA NOT NULL CHECK (
        octet_length(payload) > 0 AND octet_length(payload) <= 262144
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One item may occur in several immutable source snapshots. alert_id is stable
-- across snapshots and is derived from the canonical official BfArM item URL.
CREATE TABLE medication_intelligence_safety_alert_items (
    snapshot_id UUID NOT NULL
        REFERENCES medication_intelligence_source_snapshots(id) ON DELETE RESTRICT,
    source_id TEXT NOT NULL
        REFERENCES medication_intelligence_sources(id) ON DELETE RESTRICT,
    alert_id TEXT NOT NULL CHECK (alert_id ~ '^bfarm-rhb-[0-9a-f]{24}$'),
    official_title TEXT NOT NULL CHECK (
        btrim(official_title) <> '' AND length(official_title) <= 1000
    ),
    official_url TEXT NOT NULL CHECK (
        official_url ~ '^https://www[.]bfarm[.]de/SharedDocs/Risikoinformationen/Pharmakovigilanz/DE/RHB/'
    ),
    published_at TIMESTAMPTZ,
    explicit_substance_labels TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    explicit_substance_keys TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    item_checksum_sha256 TEXT NOT NULL CHECK (item_checksum_sha256 ~ '^[0-9a-f]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (snapshot_id, alert_id),
    CHECK (cardinality(explicit_substance_labels) = cardinality(explicit_substance_keys))
);

CREATE INDEX idx_medication_intelligence_alert_items_latest
    ON medication_intelligence_safety_alert_items(source_id, snapshot_id, published_at DESC);

CREATE INDEX idx_medication_intelligence_alert_items_substances
    ON medication_intelligence_safety_alert_items
    USING GIN (explicit_substance_keys);

CREATE TRIGGER prevent_medication_intelligence_payload_mutation
    BEFORE UPDATE OR DELETE ON medication_intelligence_source_payloads
    FOR EACH ROW
    EXECUTE FUNCTION prevent_medication_intelligence_snapshot_mutation();

CREATE TRIGGER prevent_medication_intelligence_alert_item_mutation
    BEFORE UPDATE OR DELETE ON medication_intelligence_safety_alert_items
    FOR EACH ROW
    EXECUTE FUNCTION prevent_medication_intelligence_snapshot_mutation();
