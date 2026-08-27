-- Versioned G-BA AIS complete-delivery connector.
--
-- The permanent automated download URL is an operator secret issued by G-BA.
-- It is never stored in this registry or exposed through an API. The worker
-- records the public AIS reference page as provenance and is enabled only when
-- GMED_GBA_AIS_DOWNLOAD_URL is configured.

UPDATE medication_intelligence_sources
SET freshness_ttl_hours = 384,
    metadata = metadata || jsonb_build_object(
        'contract', 'G-BA_Beschluss_Info_2023',
        'activation_note', 'Connector is enabled only with an operator-provided permanent G-BA download URL.',
        'public_reference_url', 'https://www.g-ba.de/themen/arzneimittel/arzneimittel-richtlinie-anlagen/nutzenbewertung-35a/ais/',
        'schedule_hours', 12,
        'claim_lease_minutes', 10,
        'payload_policy', 'Keep the bounded complete XML delivery internally for reproducibility; expose only normalized provenance.'
    )
WHERE id = 'gba_ais_xml';

-- The AIS XML is a complete delivery and can be materially larger than the
-- small BfArM RSS feed. Keep one shared immutable payload store with a strict
-- 64 MiB upper bound; each connector enforces its own tighter network limit.
ALTER TABLE medication_intelligence_source_payloads
    DROP CONSTRAINT medication_intelligence_source_payloads_payload_check;

ALTER TABLE medication_intelligence_source_payloads
    ADD CONSTRAINT medication_intelligence_source_payloads_payload_check CHECK (
        octet_length(payload) > 0 AND octet_length(payload) <= 67108864
    );

-- One normalized row represents one G-BA patient group in one immutable
-- complete-delivery snapshot. No patient-specific recommendation is derived
-- from this table; it is an exact, source-backed evidence index only.
CREATE TABLE medication_intelligence_benefit_assessment_items (
    snapshot_id UUID NOT NULL
        REFERENCES medication_intelligence_source_snapshots(id) ON DELETE RESTRICT,
    source_id TEXT NOT NULL
        REFERENCES medication_intelligence_sources(id) ON DELETE RESTRICT,
    CHECK (source_id = 'gba_ais_xml'),
    patient_group_id TEXT NOT NULL CHECK (patient_group_id ~ '^[0-9]{1,9}$'),
    decision_id TEXT NOT NULL CHECK (decision_id ~ '^[0-9]{1,9}$'),
    dossier_reference TEXT NOT NULL CHECK (
        btrim(dossier_reference) <> '' AND length(dossier_reference) <= 64
    ),
    official_url TEXT NOT NULL CHECK (
        official_url ~ '^https://(www[.])?g-ba[.]de/'
    ),
    assessment_type TEXT NOT NULL CHECK (
        assessment_type IN ('Beschluss_reg', 'Beschluss_orph', 'Beschluss_antib')
    ),
    assessed_substances TEXT[] NOT NULL,
    atc_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ask_numbers TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    pzns TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    trade_names TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    decision_date DATE NOT NULL,
    valid_until DATE,
    indication_short TEXT NOT NULL CHECK (
        btrim(indication_short) <> '' AND length(indication_short) <= 255
    ),
    patient_group TEXT NOT NULL CHECK (
        btrim(patient_group) <> '' AND length(patient_group) <= 1500
    ),
    benefit_extent TEXT NOT NULL CHECK (
        btrim(benefit_extent) <> '' AND length(benefit_extent) <= 256
    ),
    benefit_probability TEXT CHECK (
        benefit_probability IS NULL OR length(benefit_probability) <= 64
    ),
    item_checksum_sha256 TEXT NOT NULL CHECK (
        item_checksum_sha256 ~ '^[0-9a-f]{64}$'
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (snapshot_id, patient_group_id),
    CHECK (cardinality(assessed_substances) BETWEEN 1 AND 32),
    CHECK (cardinality(atc_codes) <= 64),
    CHECK (cardinality(ask_numbers) <= 64),
    CHECK (cardinality(pzns) <= 4096),
    CHECK (cardinality(trade_names) <= 256),
    CHECK (valid_until IS NULL OR valid_until >= decision_date)
);

CREATE INDEX idx_medication_intelligence_benefit_items_latest
    ON medication_intelligence_benefit_assessment_items(
        source_id, snapshot_id, decision_date DESC, patient_group_id
    );

CREATE INDEX idx_medication_intelligence_benefit_items_atc
    ON medication_intelligence_benefit_assessment_items USING GIN (atc_codes);

CREATE INDEX idx_medication_intelligence_benefit_items_pzn
    ON medication_intelligence_benefit_assessment_items USING GIN (pzns);

CREATE TRIGGER prevent_medication_intelligence_benefit_item_mutation
    BEFORE UPDATE OR DELETE ON medication_intelligence_benefit_assessment_items
    FOR EACH ROW
    EXECUTE FUNCTION prevent_medication_intelligence_snapshot_mutation();
