-- Immutable audit record for confirmed KBV BMP 2.8 carrier XML imports.
-- Raw XML is deliberately not retained. The bounded, normalized snapshot is
-- patient-owned and follows the patient GDPR cascade.

CREATE TABLE patient_bmp_imports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    plan_instance_id TEXT NOT NULL,
    bmp_version TEXT NOT NULL CHECK (bmp_version = '028'),
    locale TEXT NOT NULL CHECK (locale = 'de-DE'),
    parser_version TEXT NOT NULL CHECK (parser_version = 'gmed-bmp-import-v1'),
    carrier_sha256 TEXT NOT NULL CHECK (carrier_sha256 ~ '^[0-9a-f]{64}$'),
    preview_fingerprint TEXT NOT NULL CHECK (preview_fingerprint ~ '^[0-9a-f]{64}$'),
    strategy TEXT NOT NULL CHECK (strategy = 'replace_current'),
    status TEXT NOT NULL CHECK (status = 'confirmed'),
    source_printed_at TIMESTAMP NOT NULL,
    identity_snapshot JSONB NOT NULL CHECK (
        jsonb_typeof(identity_snapshot) = 'object'
        AND octet_length(identity_snapshot::text) <= 16384
    ),
    plan_snapshot JSONB NOT NULL CHECK (
        jsonb_typeof(plan_snapshot) = 'object'
        AND octet_length(plan_snapshot::text) <= 262144
    ),
    medication_ids UUID[] NOT NULL CHECK (cardinality(medication_ids) > 0),
    imported_count INTEGER NOT NULL CHECK (imported_count > 0),
    superseded_count INTEGER NOT NULL CHECK (superseded_count >= 0),
    idempotency_key_hash TEXT NOT NULL CHECK (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
    confirmed_by UUID NOT NULL,
    confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT patient_bmp_imports_actor_idempotency_unique
        UNIQUE (confirmed_by, idempotency_key_hash)
);

CREATE INDEX idx_patient_bmp_imports_patient_confirmed
    ON patient_bmp_imports(patient_id, confirmed_at DESC);

CREATE OR REPLACE FUNCTION prevent_patient_bmp_import_update()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'patient_bmp_imports is immutable; updates are forbidden';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER patient_bmp_imports_immutable_update
    BEFORE UPDATE ON patient_bmp_imports
    FOR EACH ROW EXECUTE FUNCTION prevent_patient_bmp_import_update();

COMMENT ON TABLE patient_bmp_imports IS
    'Append-only under normal application operation; deletion is permitted only through patient-owned privacy erasure cascade.';
