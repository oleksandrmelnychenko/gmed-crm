-- Local-only medication identity workflow.
--
-- Candidate evidence is snapshotted because drug_products is an editable
-- operational catalogue. A later catalogue edit must not rewrite what a CEO
-- reviewed and confirmed for a patient medication.

CREATE UNIQUE INDEX uq_patient_medications_patient_identity
    ON patient_medications(patient_id, id);

CREATE TABLE medication_identity_candidate_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    patient_medication_id UUID NOT NULL REFERENCES patient_medications(id) ON DELETE CASCADE,
    medication_version TEXT NOT NULL,
    catalog_version TEXT NOT NULL,
    ruleset_version TEXT NOT NULL,
    medication_snapshot JSONB NOT NULL,
    query_basis JSONB NOT NULL DEFAULT '[]'::jsonb,
    provenance_source_state TEXT NOT NULL DEFAULT 'internal_curated'
        CHECK (provenance_source_state = 'internal_curated'),
    generated_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    CONSTRAINT medication_identity_candidate_sets_medication_snapshot_object
        CHECK (
            jsonb_typeof(medication_snapshot) = 'object'
            AND octet_length(medication_snapshot::text) <= 65536
        ),
    CONSTRAINT medication_identity_candidate_sets_query_basis_array
        CHECK (
            jsonb_typeof(query_basis) = 'array'
            AND octet_length(query_basis::text) <= 8192
        ),
    CONSTRAINT medication_identity_candidate_sets_version_not_blank
        CHECK (
            btrim(medication_version) <> ''
            AND btrim(catalog_version) <> ''
            AND btrim(ruleset_version) <> ''
        ),
    CONSTRAINT medication_identity_candidate_sets_internal_no_expiry
        CHECK (provenance_source_state <> 'internal_curated' OR expires_at IS NULL),
    CONSTRAINT medication_identity_candidate_set_patient_medication_fk
        FOREIGN KEY (patient_id, patient_medication_id)
        REFERENCES patient_medications(patient_id, id)
        ON DELETE CASCADE,
    UNIQUE (id, patient_id, patient_medication_id),
    UNIQUE (
        patient_medication_id,
        medication_version,
        catalog_version,
        ruleset_version
    )
);

CREATE INDEX idx_medication_identity_candidate_sets_latest
    ON medication_identity_candidate_sets(patient_medication_id, generated_at DESC, id DESC);

CREATE TABLE medication_identity_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_set_id UUID NOT NULL
        REFERENCES medication_identity_candidate_sets(id) ON DELETE CASCADE,
    drug_product_id UUID NOT NULL REFERENCES drug_products(id) ON DELETE RESTRICT,
    rank INTEGER NOT NULL CHECK (rank > 0),
    product_snapshot JSONB NOT NULL,
    match_basis TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    confirmable BOOLEAN NOT NULL DEFAULT false,
    blocking_reasons TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    evidence JSONB NOT NULL,
    provenance JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT medication_identity_candidates_product_snapshot_object
        CHECK (
            jsonb_typeof(product_snapshot) = 'object'
            AND octet_length(product_snapshot::text) <= 65536
        ),
    CONSTRAINT medication_identity_candidates_evidence_object
        CHECK (
            jsonb_typeof(evidence) = 'object'
            AND octet_length(evidence::text) <= 32768
        ),
    CONSTRAINT medication_identity_candidates_provenance_object
        CHECK (
            jsonb_typeof(provenance) = 'object'
            AND provenance->>'source_state' = 'internal_curated'
            AND octet_length(provenance::text) <= 16384
        ),
    CONSTRAINT medication_identity_candidates_match_basis_values
        CHECK (
            match_basis <@ ARRAY[
                'exact_pzn',
                'exact_substance',
                'exact_strength',
                'exact_form'
            ]::TEXT[]
        ),
    CONSTRAINT medication_identity_candidates_blocking_reasons_bounded
        CHECK (cardinality(blocking_reasons) <= 16),
    UNIQUE (candidate_set_id, id),
    UNIQUE (candidate_set_id, drug_product_id),
    UNIQUE (candidate_set_id, rank)
);

CREATE INDEX idx_medication_identity_candidates_set_rank
    ON medication_identity_candidates(candidate_set_id, rank, id);

CREATE TABLE medication_identity_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    patient_medication_id UUID NOT NULL REFERENCES patient_medications(id) ON DELETE CASCADE,
    candidate_set_id UUID NOT NULL
        REFERENCES medication_identity_candidate_sets(id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('confirmed', 'rejected')),
    medication_version TEXT NOT NULL CHECK (btrim(medication_version) <> ''),
    source_snapshot_id UUID
        REFERENCES medication_intelligence_source_snapshots(id) ON DELETE RESTRICT,
    product_snapshot JSONB NOT NULL,
    staff_acknowledged BOOLEAN NOT NULL,
    note TEXT,
    idempotency_key TEXT,
    refresh_token UUID NOT NULL DEFAULT gen_random_uuid(),
    decided_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT medication_identity_decisions_product_snapshot_object
        CHECK (
            jsonb_typeof(product_snapshot) = 'object'
            AND octet_length(product_snapshot::text) <= 65536
        ),
    CONSTRAINT medication_identity_decisions_note_bounded
        CHECK (note IS NULL OR char_length(note) <= 2000),
    CONSTRAINT medication_identity_decisions_idempotency_key_bounded
        CHECK (
            idempotency_key IS NULL
            OR (btrim(idempotency_key) <> '' AND char_length(idempotency_key) <= 128)
        ),
    CONSTRAINT medication_identity_confirmed_requires_acknowledgement
        CHECK (decision <> 'confirmed' OR staff_acknowledged = true),
    CONSTRAINT medication_identity_decision_candidate_set_subject_fk
        FOREIGN KEY (candidate_set_id, patient_id, patient_medication_id)
        REFERENCES medication_identity_candidate_sets(
            id, patient_id, patient_medication_id
        )
        ON DELETE CASCADE,
    CONSTRAINT medication_identity_decision_candidate_set_fk
        FOREIGN KEY (candidate_set_id, candidate_id)
        REFERENCES medication_identity_candidates(candidate_set_id, id)
        ON DELETE CASCADE,
    UNIQUE (refresh_token)
);

CREATE UNIQUE INDEX uq_medication_identity_confirmed_candidate
    ON medication_identity_decisions(candidate_id)
    WHERE decision = 'confirmed';

CREATE UNIQUE INDEX uq_medication_identity_confirmed_medication_version
    ON medication_identity_decisions(patient_medication_id, medication_version)
    WHERE decision = 'confirmed';

CREATE UNIQUE INDEX uq_medication_identity_decision_idempotency
    ON medication_identity_decisions(decided_by, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_medication_identity_decisions_medication
    ON medication_identity_decisions(patient_medication_id, decided_at DESC, id DESC);

CREATE OR REPLACE FUNCTION prevent_medication_identity_evidence_update()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'medication identity evidence is immutable; append a new decision instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER medication_identity_candidate_sets_immutable
    BEFORE UPDATE ON medication_identity_candidate_sets
    FOR EACH ROW
    EXECUTE FUNCTION prevent_medication_identity_evidence_update();

CREATE TRIGGER medication_identity_candidates_immutable
    BEFORE UPDATE ON medication_identity_candidates
    FOR EACH ROW
    EXECUTE FUNCTION prevent_medication_identity_evidence_update();

CREATE TRIGGER medication_identity_decisions_immutable
    BEFORE UPDATE ON medication_identity_decisions
    FOR EACH ROW
    EXECUTE FUNCTION prevent_medication_identity_evidence_update();

COMMENT ON TABLE medication_identity_candidate_sets IS
    'Versioned local-catalog search inputs for explicit medication identity review. Rows cannot be updated; patient privacy erasure may cascade-delete them.';
COMMENT ON TABLE medication_identity_candidates IS
    'Deterministic candidate evidence; never an automatic medication identity decision. Rows cannot be updated; patient privacy erasure may cascade-delete them.';
COMMENT ON TABLE medication_identity_decisions IS
    'Append-only staff decisions during the patient retention period. medication_drug_matches remains the current projection; patient privacy erasure may cascade-delete decisions.';
