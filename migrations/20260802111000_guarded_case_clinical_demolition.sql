-- Phase 6B: install (but do not execute) the guarded demolition operation.
--
-- A normal deployment only creates the approval table and function below. A
-- database owner must review case_clinical_reconciliation_report, resolve every
-- pending item, create an approval row, and explicitly call:
--
--   SELECT finalize_case_clinical_demolition('<approval uuid>');
--
-- All checks and DDL run in the caller's transaction. Any failed assertion
-- aborts before legacy rows or columns are removed.

CREATE TABLE IF NOT EXISTS case_clinical_demolition_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    approved_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    approved_at TIMESTAMPTZ NOT NULL,
    approval_note TEXT NOT NULL CHECK (btrim(approval_note) <> ''),
    completed_at TIMESTAMPTZ,
    reconciliation_snapshot JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT case_clinical_demolition_approval_not_future CHECK (
        approved_at <= created_at + INTERVAL '5 minutes'
    )
);

CREATE OR REPLACE FUNCTION finalize_case_clinical_demolition(p_approval_id UUID)
RETURNS VOID AS $$
DECLARE
    approval_row case_clinical_demolition_approvals%ROWTYPE;
    source_count BIGINT;
    ledger_count BIGINT;
    source_name TEXT;
    pending_count BIGINT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('gmed.case_clinical_demolition'));

    SELECT * INTO approval_row
    FROM case_clinical_demolition_approvals
    WHERE id = p_approval_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Clinical demolition approval % does not exist', p_approval_id;
    END IF;
    IF approval_row.completed_at IS NOT NULL THEN
        RAISE EXCEPTION 'Clinical demolition approval % was already used', p_approval_id;
    END IF;
    IF approval_row.approved_at < now() - INTERVAL '24 hours' THEN
        RAISE EXCEPTION 'Clinical demolition approval % is older than 24 hours', p_approval_id;
    END IF;

    IF to_regclass('public.medikamente') IS NULL THEN
        RAISE EXCEPTION 'Legacy clinical tables are already absent; refusing a second demolition';
    END IF;

    SELECT COUNT(*) INTO pending_count
    FROM case_clinical_reconciliation_items
    WHERE resolution_status = 'pending';
    IF pending_count <> 0 THEN
        RAISE EXCEPTION 'Clinical demolition blocked: % reconciliation item(s) remain pending', pending_count;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM case_clinical_reconciliation_items
        WHERE resolution_status = 'manually_resolved'
          AND (resolved_by IS NULL OR resolved_at IS NULL
               OR NULLIF(btrim(resolution_note), '') IS NULL)
    ) THEN
        RAISE EXCEPTION 'Clinical demolition blocked: manually resolved items lack audit metadata';
    END IF;

    -- Every legacy source row must have exactly one ledger item. The narrative
    -- source uses the case UUID as its stable row identifier.
    FOREACH source_name IN ARRAY ARRAY[
        'vorerkrankungen', 'allergien', 'operationen', 'medikamente',
        'vegetative_anamnese', 'impfstatus'
    ]
    LOOP
        EXECUTE format('SELECT COUNT(*) FROM %I', source_name) INTO source_count;
        SELECT COUNT(*) INTO ledger_count
        FROM case_clinical_reconciliation_items
        WHERE source_table = source_name;

        IF source_count <> ledger_count THEN
            RAISE EXCEPTION
                'Clinical demolition blocked: % has % source row(s) but % ledger item(s)',
                source_name, source_count, ledger_count;
        END IF;
    END LOOP;

    SELECT COUNT(*) INTO source_count
    FROM cases
    WHERE NULLIF(btrim(COALESCE(aktuelle_anamnese, '')), '') IS NOT NULL;
    SELECT COUNT(*) INTO ledger_count
    FROM case_clinical_reconciliation_items
    WHERE source_table = 'cases.aktuelle_anamnese';
    IF source_count <> ledger_count THEN
        RAISE EXCEPTION
            'Clinical demolition blocked: cases.aktuelle_anamnese has % source row(s) but % ledger item(s)',
            source_count, ledger_count;
    END IF;

    -- The frozen legal snapshot is mandatory for every case that still owns a
    -- legacy fact, even when a manual resolution chose not to create a target.
    IF EXISTS (
        SELECT 1
        FROM cases c
        WHERE c.intake_snapshot IS NULL
          AND (
              NULLIF(btrim(COALESCE(c.aktuelle_anamnese, '')), '') IS NOT NULL
              OR EXISTS (SELECT 1 FROM vorerkrankungen v WHERE v.case_id = c.id)
              OR EXISTS (SELECT 1 FROM allergien a WHERE a.case_id = c.id)
              OR EXISTS (SELECT 1 FROM operationen o WHERE o.case_id = c.id)
              OR EXISTS (SELECT 1 FROM medikamente m WHERE m.case_id = c.id)
              OR EXISTS (SELECT 1 FROM vegetative_anamnese va WHERE va.case_id = c.id)
              OR EXISTS (SELECT 1 FROM impfstatus i WHERE i.case_id = c.id)
          )
    ) THEN
        RAISE EXCEPTION 'Clinical demolition blocked: at least one legacy case lacks intake_snapshot';
    END IF;

    SELECT COUNT(*) INTO source_count FROM medikamente;
    SELECT COUNT(*) INTO ledger_count FROM legacy_medication_patient_map;
    IF source_count <> ledger_count THEN
        RAISE EXCEPTION
            'Clinical demolition blocked: % medication row(s), but % UUID mapping row(s)',
            source_count, ledger_count;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM legacy_medication_patient_map lm
        LEFT JOIN patient_medications pm ON pm.id = lm.patient_medication_id
        WHERE lm.patient_medication_id IS NULL OR pm.id IS NULL
    ) THEN
        RAISE EXCEPTION 'Clinical demolition blocked: a legacy medication lacks a live patient-medication target';
    END IF;

    -- Pharma rows cannot be accepted by snapshot alone: each legacy link/event
    -- needs a live patient-side target before its old FK columns can be dropped.
    IF EXISTS (
        SELECT 1
        FROM medication_drug_matches legacy
        LEFT JOIN case_clinical_reconciliation_items item
          ON item.source_table = 'medication_drug_matches'
         AND item.source_row_id = legacy.id
        LEFT JOIN medication_drug_matches target
          ON target.id = item.target_row_id
         AND target.patient_medication_id IS NOT NULL
        WHERE legacy.patient_medication_id IS NULL
          AND (item.resolution_status IS NULL
               OR item.resolution_status = 'pending'
               OR target.id IS NULL)
    ) THEN
        RAISE EXCEPTION 'Clinical demolition blocked: an old drug match lacks a resolved live patient-side target';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM medication_expiry_events legacy
        LEFT JOIN case_clinical_reconciliation_items item
          ON item.source_table = 'medication_expiry_events'
         AND item.source_row_id = legacy.id
        LEFT JOIN medication_expiry_events target
          ON target.id = item.target_row_id
         AND target.patient_medication_id IS NOT NULL
        WHERE legacy.patient_medication_id IS NULL
          AND (item.resolution_status IS NULL
               OR item.resolution_status = 'pending'
               OR target.id IS NULL)
    ) THEN
        RAISE EXCEPTION 'Clinical demolition blocked: an old expiry event lacks a resolved live patient-side target';
    END IF;

    -- orders.case_id must be a lossless replacement for onboarding_order_id.
    IF EXISTS (
        SELECT 1
        FROM cases c
        JOIN orders o ON o.id = c.onboarding_order_id
        WHERE c.onboarding_order_id IS NOT NULL
          AND o.case_id IS NOT NULL
          AND o.case_id <> c.id
    ) THEN
        RAISE EXCEPTION 'Clinical demolition blocked: an onboarding order points at a different case';
    END IF;

    UPDATE orders o
    SET case_id = c.id
    FROM cases c
    WHERE c.onboarding_order_id = o.id
      AND o.case_id IS NULL;

    IF EXISTS (
        SELECT 1
        FROM cases c
        JOIN orders o ON o.id = c.onboarding_order_id
        WHERE c.onboarding_order_id IS NOT NULL
          AND o.case_id IS DISTINCT FROM c.id
    ) THEN
        RAISE EXCEPTION 'Clinical demolition blocked: onboarding order backfill is incomplete';
    END IF;

    UPDATE case_clinical_demolition_approvals
    SET reconciliation_snapshot = jsonb_build_object(
        'captured_at', now(),
        'items', (SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
                  FROM case_clinical_reconciliation_report r),
        'legacy_medications', (SELECT COUNT(*) FROM medikamente),
        'legacy_drug_matches', (
            SELECT COUNT(*) FROM medication_drug_matches
            WHERE patient_medication_id IS NULL
        ),
        'legacy_expiry_events', (
            SELECT COUNT(*) FROM medication_expiry_events
            WHERE patient_medication_id IS NULL
        )
    )
    WHERE id = p_approval_id;

    -- Destructive work starts only after every assertion above has passed.
    DELETE FROM medication_drug_matches WHERE patient_medication_id IS NULL;
    DELETE FROM medication_expiry_events WHERE patient_medication_id IS NULL;

    ALTER TABLE medication_drug_matches
        DROP CONSTRAINT IF EXISTS medication_drug_matches_subject_chk;
    ALTER TABLE medication_drug_matches
        DROP COLUMN case_id,
        DROP COLUMN medication_id;
    ALTER TABLE medication_drug_matches
        ALTER COLUMN patient_medication_id SET NOT NULL;

    ALTER TABLE medication_expiry_events
        DROP CONSTRAINT IF EXISTS medication_expiry_events_subject_chk;
    ALTER TABLE medication_expiry_events
        DROP COLUMN case_id,
        DROP COLUMN medication_id;
    ALTER TABLE medication_expiry_events
        ALTER COLUMN patient_medication_id SET NOT NULL;

    ALTER TABLE cases DROP COLUMN onboarding_order_id;
    DROP TABLE vorerkrankungen;
    DROP TABLE allergien;
    DROP TABLE operationen;
    DROP TABLE medikamente;
    DROP TABLE vegetative_anamnese;
    DROP TABLE impfstatus;
    ALTER TABLE cases DROP COLUMN aktuelle_anamnese;

    UPDATE case_clinical_demolition_approvals
    SET completed_at = now()
    WHERE id = p_approval_id;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION finalize_case_clinical_demolition(UUID) FROM PUBLIC;

COMMENT ON FUNCTION finalize_case_clinical_demolition(UUID) IS
    'DB-owner-only Phase 6B operation. Refuses demolition until reconciliation, UUID mapping, pharma targets, snapshots, and order links are complete.';
