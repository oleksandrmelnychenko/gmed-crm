-- Phase 6A: non-destructive clinical reconciliation.
--
-- This migration intentionally performs no demolition. Every legacy row is
-- snapshotted and registered in case_clinical_reconciliation_items before a
-- patient-side copy is considered. Exact patient rows are mapped as-is. A
-- case row without an exact match is copied as a distinct patient fact; when a
-- natural-key candidate already exists, the item remains a visible
-- preserved_conflict for manual review. No "patient wins" overwrite occurs.

ALTER TABLE cases ADD COLUMN IF NOT EXISTS intake_snapshot JSONB;

CREATE TABLE IF NOT EXISTS case_clinical_reconciliation_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_table TEXT NOT NULL,
    source_row_id UUID NOT NULL,
    case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    target_table TEXT,
    target_row_id UUID,
    classification TEXT NOT NULL CHECK (classification IN (
        'exact_match',
        'copied_case_only',
        'preserved_conflict',
        'unmapped_subject'
    )),
    resolution_status TEXT NOT NULL DEFAULT 'pending' CHECK (resolution_status IN (
        'pending', 'auto_resolved', 'manually_resolved'
    )),
    source_payload JSONB NOT NULL,
    target_payload JSONB,
    resolution_note TEXT,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT case_clinical_reconciliation_source_unique
        UNIQUE (source_table, source_row_id),
    CONSTRAINT case_clinical_reconciliation_resolution_metadata_chk CHECK (
        resolution_status <> 'manually_resolved'
        OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL
            AND NULLIF(btrim(resolution_note), '') IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_case_clinical_reconciliation_status
    ON case_clinical_reconciliation_items(classification, resolution_status);
CREATE INDEX IF NOT EXISTS idx_case_clinical_reconciliation_case
    ON case_clinical_reconciliation_items(case_id, source_table);

CREATE TABLE IF NOT EXISTS legacy_medication_patient_map (
    legacy_medication_id UUID PRIMARY KEY,
    case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    patient_medication_id UUID REFERENCES patient_medications(id) ON DELETE CASCADE,
    mapping_kind TEXT NOT NULL CHECK (mapping_kind IN (
        'exact_match', 'copied_case_only', 'preserved_conflict', 'unmapped_subject'
    )),
    source_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT legacy_medication_patient_map_target_chk CHECK (
        (mapping_kind = 'unmapped_subject' AND patient_medication_id IS NULL)
        OR (mapping_kind <> 'unmapped_subject' AND patient_medication_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_legacy_medication_patient_map_target
    ON legacy_medication_patient_map(patient_medication_id)
    WHERE patient_medication_id IS NOT NULL;

-- Legacy cases without a patient are deliberately not re-homed here. Identity
-- matching requires an operator decision; auto-creating a prospect could turn
-- a returning patient into a duplicate. Their rows enter the ledger as
-- unmapped_subject and block demolition until that decision has been made.

-- Freeze the complete legacy payload, including source UUIDs, before copying.
UPDATE cases c
SET intake_snapshot = jsonb_strip_nulls(jsonb_build_object(
        'hauptanfragegrund', c.hauptanfragegrund,
        'aktuelle_anamnese', c.aktuelle_anamnese,
        'vorerkrankungen', (SELECT jsonb_agg(to_jsonb(v) ORDER BY v.sort_order, v.id)
                            FROM vorerkrankungen v WHERE v.case_id = c.id),
        'allergien', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.sort_order, a.id)
                      FROM allergien a WHERE a.case_id = c.id),
        'medikamente', (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.sort_order, m.id)
                        FROM medikamente m WHERE m.case_id = c.id),
        'operationen', (SELECT jsonb_agg(to_jsonb(o) ORDER BY o.sort_order, o.id)
                        FROM operationen o WHERE o.case_id = c.id),
        'vegetative', (SELECT to_jsonb(va) FROM vegetative_anamnese va WHERE va.case_id = c.id),
        'impfstatus', (SELECT to_jsonb(i) FROM impfstatus i WHERE i.case_id = c.id),
        'frozen_at', now(),
        'snapshot_schema', 'case_clinical_v1'
    ))
WHERE c.intake_snapshot IS NULL
  AND (
      NULLIF(btrim(COALESCE(c.aktuelle_anamnese, '')), '') IS NOT NULL
      OR EXISTS (SELECT 1 FROM vorerkrankungen v WHERE v.case_id = c.id)
      OR EXISTS (SELECT 1 FROM allergien a WHERE a.case_id = c.id)
      OR EXISTS (SELECT 1 FROM medikamente m WHERE m.case_id = c.id)
      OR EXISTS (SELECT 1 FROM operationen o WHERE o.case_id = c.id)
      OR EXISTS (SELECT 1 FROM vegetative_anamnese va WHERE va.case_id = c.id)
      OR EXISTS (SELECT 1 FROM impfstatus i WHERE i.case_id = c.id)
  );

-- Incomplete leads stay legacy. Their wizard draft is a second recoverable copy;
-- intake_model is deliberately not flipped until a prospect can be created.
UPDATE leads l
SET wizard_state = jsonb_set(
    COALESCE(l.wizard_state, '{}'::jsonb),
    '{clinical_draft}',
    c.intake_snapshot,
    true
)
FROM cases c
WHERE c.lead_id = l.id
  AND c.patient_id IS NULL
  AND c.intake_snapshot IS NOT NULL
  AND (l.wizard_state IS NULL OR NOT (l.wizard_state ? 'clinical_draft'));

UPDATE leads
SET wizard_state = wizard_state - 'clinical_draft'
WHERE qualification_status = 'deleted'
  AND wizard_state ? 'clinical_draft';

-- Structured rows: exact rows are reused; non-exact rows are copied. A
-- same-natural-key mismatch is preserved but remains pending for manual merge.
DO $$
DECLARE
    source_row RECORD;
    target_id UUID;
    natural_match BOOLEAN;
    item_classification TEXT;
    item_resolution TEXT;
BEGIN
    FOR source_row IN
        SELECT v.*, c.patient_id
        FROM vorerkrankungen v
        JOIN cases c ON c.id = v.case_id
    LOOP
        IF source_row.patient_id IS NULL THEN
            INSERT INTO case_clinical_reconciliation_items (
                source_table, source_row_id, case_id, classification,
                resolution_status, source_payload
            ) VALUES (
                'vorerkrankungen', source_row.id, source_row.case_id,
                'unmapped_subject', 'pending', to_jsonb(source_row) - 'patient_id'
            ) ON CONFLICT (source_table, source_row_id) DO NOTHING;
            CONTINUE;
        END IF;

        target_id := NULL;
        SELECT d.id INTO target_id
        FROM patient_diagnoses d
        WHERE d.patient_id = source_row.patient_id
          AND lower(btrim(d.label)) = lower(btrim(source_row.erkrankung))
          AND d.diagnosed_on IS NOT DISTINCT FROM NULLIF(btrim(COALESCE(source_row.erstdiagnose, '')), '')
          AND d.note IS NOT DISTINCT FROM source_row.notiz
        ORDER BY d.created_at, d.id LIMIT 1;

        IF target_id IS NOT NULL THEN
            item_classification := 'exact_match';
            item_resolution := 'auto_resolved';
        ELSE
            SELECT EXISTS (
                SELECT 1 FROM patient_diagnoses d
                WHERE d.patient_id = source_row.patient_id
                  AND lower(btrim(d.label)) = lower(btrim(source_row.erkrankung))
            ) INTO natural_match;

            INSERT INTO patient_diagnoses (
                patient_id, case_id, kind, label, certainty,
                diagnosed_on, note, status, sort_order
            ) VALUES (
                source_row.patient_id, source_row.case_id, 'secondary',
                source_row.erkrankung, 'bestaetigt',
                NULLIF(btrim(COALESCE(source_row.erstdiagnose, '')), ''),
                source_row.notiz, 'active', source_row.sort_order
            ) RETURNING id INTO target_id;

            item_classification := CASE WHEN natural_match
                THEN 'preserved_conflict' ELSE 'copied_case_only' END;
            item_resolution := CASE WHEN natural_match
                THEN 'pending' ELSE 'auto_resolved' END;
        END IF;

        INSERT INTO case_clinical_reconciliation_items (
            source_table, source_row_id, case_id, patient_id,
            target_table, target_row_id, classification, resolution_status,
            source_payload, target_payload
        ) VALUES (
            'vorerkrankungen', source_row.id, source_row.case_id, source_row.patient_id,
            'patient_diagnoses', target_id, item_classification, item_resolution,
            to_jsonb(source_row) - 'patient_id',
            (SELECT to_jsonb(d) FROM patient_diagnoses d WHERE d.id = target_id)
        ) ON CONFLICT (source_table, source_row_id) DO NOTHING;
    END LOOP;

    FOR source_row IN
        SELECT a.*, c.patient_id
        FROM allergien a
        JOIN cases c ON c.id = a.case_id
    LOOP
        IF source_row.patient_id IS NULL THEN
            INSERT INTO case_clinical_reconciliation_items (
                source_table, source_row_id, case_id, classification,
                resolution_status, source_payload
            ) VALUES (
                'allergien', source_row.id, source_row.case_id,
                'unmapped_subject', 'pending', to_jsonb(source_row) - 'patient_id'
            ) ON CONFLICT (source_table, source_row_id) DO NOTHING;
            CONTINUE;
        END IF;

        target_id := NULL;
        SELECT w.id INTO target_id
        FROM patient_clinical_warnings w
        WHERE w.patient_id = source_row.patient_id
          AND w.kind = 'allergie'
          AND lower(btrim(w.label)) = lower(btrim(source_row.allergie))
          AND w.reaction IS NOT DISTINCT FROM source_row.reaktion
        ORDER BY w.created_at, w.id LIMIT 1;

        IF target_id IS NOT NULL THEN
            item_classification := 'exact_match';
            item_resolution := 'auto_resolved';
        ELSE
            SELECT EXISTS (
                SELECT 1 FROM patient_clinical_warnings w
                WHERE w.patient_id = source_row.patient_id
                  AND w.kind = 'allergie'
                  AND lower(btrim(w.label)) = lower(btrim(source_row.allergie))
            ) INTO natural_match;

            INSERT INTO patient_clinical_warnings (
                patient_id, kind, label, reaction, sort_order
            ) VALUES (
                source_row.patient_id, 'allergie', source_row.allergie,
                source_row.reaktion, source_row.sort_order
            ) RETURNING id INTO target_id;

            item_classification := CASE WHEN natural_match
                THEN 'preserved_conflict' ELSE 'copied_case_only' END;
            item_resolution := CASE WHEN natural_match
                THEN 'pending' ELSE 'auto_resolved' END;
        END IF;

        INSERT INTO case_clinical_reconciliation_items (
            source_table, source_row_id, case_id, patient_id,
            target_table, target_row_id, classification, resolution_status,
            source_payload, target_payload
        ) VALUES (
            'allergien', source_row.id, source_row.case_id, source_row.patient_id,
            'patient_clinical_warnings', target_id, item_classification, item_resolution,
            to_jsonb(source_row) - 'patient_id',
            (SELECT to_jsonb(w) FROM patient_clinical_warnings w WHERE w.id = target_id)
        ) ON CONFLICT (source_table, source_row_id) DO NOTHING;
    END LOOP;

    FOR source_row IN
        SELECT o.*, c.patient_id
        FROM operationen o
        JOIN cases c ON c.id = o.case_id
    LOOP
        IF source_row.patient_id IS NULL THEN
            INSERT INTO case_clinical_reconciliation_items (
                source_table, source_row_id, case_id, classification,
                resolution_status, source_payload
            ) VALUES (
                'operationen', source_row.id, source_row.case_id,
                'unmapped_subject', 'pending', to_jsonb(source_row) - 'patient_id'
            ) ON CONFLICT (source_table, source_row_id) DO NOTHING;
            CONTINUE;
        END IF;

        target_id := NULL;
        SELECT p.id INTO target_id
        FROM patient_procedures p
        WHERE p.patient_id = source_row.patient_id
          AND lower(btrim(p.label)) = lower(btrim(source_row.grund))
          AND p.performed_on IS NOT DISTINCT FROM source_row.datum::TEXT
          AND p.note IS NOT DISTINCT FROM NULLIF(
              btrim(concat_ws(' · ', source_row.arzt, source_row.notiz)), ''
          )
        ORDER BY p.created_at, p.id LIMIT 1;

        IF target_id IS NOT NULL THEN
            item_classification := 'exact_match';
            item_resolution := 'auto_resolved';
        ELSE
            SELECT EXISTS (
                SELECT 1 FROM patient_procedures p
                WHERE p.patient_id = source_row.patient_id
                  AND lower(btrim(p.label)) = lower(btrim(source_row.grund))
                  AND p.performed_on IS NOT DISTINCT FROM source_row.datum::TEXT
            ) INTO natural_match;

            INSERT INTO patient_procedures (
                patient_id, case_id, label, performed_on, note, doctor_id, sort_order
            ) VALUES (
                source_row.patient_id, source_row.case_id, source_row.grund,
                source_row.datum::TEXT,
                NULLIF(btrim(concat_ws(' · ', source_row.arzt, source_row.notiz)), ''),
                source_row.doctor_id, source_row.sort_order
            ) RETURNING id INTO target_id;

            item_classification := CASE WHEN natural_match
                THEN 'preserved_conflict' ELSE 'copied_case_only' END;
            item_resolution := CASE WHEN natural_match
                THEN 'pending' ELSE 'auto_resolved' END;
        END IF;

        INSERT INTO case_clinical_reconciliation_items (
            source_table, source_row_id, case_id, patient_id,
            target_table, target_row_id, classification, resolution_status,
            source_payload, target_payload
        ) VALUES (
            'operationen', source_row.id, source_row.case_id, source_row.patient_id,
            'patient_procedures', target_id, item_classification, item_resolution,
            to_jsonb(source_row) - 'patient_id',
            (SELECT to_jsonb(p) FROM patient_procedures p WHERE p.id = target_id)
        ) ON CONFLICT (source_table, source_row_id) DO NOTHING;
    END LOOP;
END $$;

-- Medication mapping is explicit because pharma matches and expiry events must
-- follow the exact legacy medication UUID, never a name-only guess.
DO $$
DECLARE
    source_row RECORD;
    target_id UUID;
    natural_match BOOLEAN;
    mapping_kind_value TEXT;
    resolution_value TEXT;
BEGIN
    FOR source_row IN
        SELECT m.*, c.patient_id
        FROM medikamente m
        JOIN cases c ON c.id = m.case_id
    LOOP
        IF source_row.patient_id IS NULL THEN
            INSERT INTO legacy_medication_patient_map (
                legacy_medication_id, case_id, mapping_kind, source_payload
            ) VALUES (
                source_row.id, source_row.case_id, 'unmapped_subject',
                to_jsonb(source_row) - 'patient_id'
            ) ON CONFLICT (legacy_medication_id) DO NOTHING;

            INSERT INTO case_clinical_reconciliation_items (
                source_table, source_row_id, case_id, classification,
                resolution_status, source_payload
            ) VALUES (
                'medikamente', source_row.id, source_row.case_id,
                'unmapped_subject', 'pending', to_jsonb(source_row) - 'patient_id'
            ) ON CONFLICT (source_table, source_row_id) DO NOTHING;
            CONTINUE;
        END IF;

        target_id := NULL;
        SELECT pm.id INTO target_id
        FROM patient_medications pm
        WHERE pm.patient_id = source_row.patient_id
          AND lower(btrim(pm.wirkstoff)) = lower(btrim(source_row.wirkstoff))
          AND lower(btrim(COALESCE(pm.handelsname, ''))) = lower(btrim(COALESCE(source_row.handelsname, '')))
          AND pm.category = CASE WHEN source_row.med_typ = 'permanent' THEN 'dauer' ELSE 'besondere' END
          AND pm.staerke IS NOT DISTINCT FROM NULLIF(
              btrim(concat_ws(' ', source_row.dosis, source_row.dosis_einheit)), ''
          )
          AND pm.form IS NOT DISTINCT FROM source_row.darreichungsform
          AND pm.hinweis IS NOT DISTINCT FROM NULLIF(
              btrim(concat_ws(' · ', source_row.einnahmeschema, source_row.anmerkung)), ''
          )
          AND pm.grund IS NOT DISTINCT FROM source_row.grund
          AND pm.einnahme_von IS NOT DISTINCT FROM NULLIF(btrim(COALESCE(source_row.seit, '')), '')
          AND pm.einnahme_bis IS NOT DISTINCT FROM source_row.expiry_date::TEXT
          AND pm.doctor_id IS NOT DISTINCT FROM source_row.verordnender_arzt_id
        ORDER BY pm.created_at, pm.id LIMIT 1;

        IF target_id IS NOT NULL THEN
            mapping_kind_value := 'exact_match';
            resolution_value := 'auto_resolved';
        ELSE
            SELECT EXISTS (
                SELECT 1 FROM patient_medications pm
                WHERE pm.patient_id = source_row.patient_id
                  AND lower(btrim(pm.wirkstoff)) = lower(btrim(source_row.wirkstoff))
                  AND lower(btrim(COALESCE(pm.handelsname, ''))) =
                      lower(btrim(COALESCE(source_row.handelsname, '')))
            ) INTO natural_match;

            INSERT INTO patient_medications (
                patient_id, category, wirkstoff, handelsname, staerke, form,
                hinweis, grund, einnahme_von, einnahme_bis, status,
                doctor_id, sort_order
            ) VALUES (
                source_row.patient_id,
                CASE WHEN source_row.med_typ = 'permanent' THEN 'dauer' ELSE 'besondere' END,
                source_row.wirkstoff, COALESCE(source_row.handelsname, ''),
                NULLIF(btrim(concat_ws(' ', source_row.dosis, source_row.dosis_einheit)), ''),
                source_row.darreichungsform,
                NULLIF(btrim(concat_ws(' · ', source_row.einnahmeschema, source_row.anmerkung)), ''),
                source_row.grund, NULLIF(btrim(COALESCE(source_row.seit, '')), ''),
                source_row.expiry_date::TEXT, 'aktiv',
                source_row.verordnender_arzt_id, source_row.sort_order
            ) RETURNING id INTO target_id;

            mapping_kind_value := CASE WHEN natural_match
                THEN 'preserved_conflict' ELSE 'copied_case_only' END;
            resolution_value := CASE WHEN natural_match
                THEN 'pending' ELSE 'auto_resolved' END;
        END IF;

        INSERT INTO legacy_medication_patient_map (
            legacy_medication_id, case_id, patient_id, patient_medication_id,
            mapping_kind, source_payload
        ) VALUES (
            source_row.id, source_row.case_id, source_row.patient_id, target_id,
            mapping_kind_value, to_jsonb(source_row) - 'patient_id'
        ) ON CONFLICT (legacy_medication_id) DO NOTHING;

        INSERT INTO case_clinical_reconciliation_items (
            source_table, source_row_id, case_id, patient_id,
            target_table, target_row_id, classification, resolution_status,
            source_payload, target_payload
        ) VALUES (
            'medikamente', source_row.id, source_row.case_id, source_row.patient_id,
            'patient_medications', target_id, mapping_kind_value, resolution_value,
            to_jsonb(source_row) - 'patient_id',
            (SELECT to_jsonb(pm) FROM patient_medications pm WHERE pm.id = target_id)
        ) ON CONFLICT (source_table, source_row_id) DO NOTHING;
    END LOOP;
END $$;

-- Single-row clinical sections are copied only into empty patient fields. A
-- differing existing value stays untouched and is staged for manual review.
DO $$
DECLARE
    source_row RECORD;
    target_id UUID;
    current_text TEXT;
    vegetative_text TEXT;
    narrative_id UUID;
    item_classification TEXT;
    item_resolution TEXT;
BEGIN
    FOR source_row IN
        SELECT c.id, c.patient_id, c.aktuelle_anamnese
        FROM cases c
        WHERE NULLIF(btrim(COALESCE(c.aktuelle_anamnese, '')), '') IS NOT NULL
    LOOP
        IF source_row.patient_id IS NULL THEN
            INSERT INTO case_clinical_reconciliation_items (
                source_table, source_row_id, case_id, classification,
                resolution_status, source_payload
            ) VALUES (
                'cases.aktuelle_anamnese', source_row.id, source_row.id,
                'unmapped_subject', 'pending',
                jsonb_build_object('aktuelle_anamnese', source_row.aktuelle_anamnese)
            ) ON CONFLICT (source_table, source_row_id) DO NOTHING;
            CONTINUE;
        END IF;

        SELECT n.id, n.anamnese_aktuelle INTO target_id, current_text
        FROM patient_clinical_narrative n
        WHERE n.patient_id = source_row.patient_id
          AND n.is_active;

        IF NOT FOUND THEN
            INSERT INTO patient_clinical_narrative (
                patient_id, case_id, anamnese_aktuelle, is_active
            ) VALUES (
                source_row.patient_id, source_row.id,
                btrim(source_row.aktuelle_anamnese), true
            ) RETURNING id INTO target_id;
            item_classification := 'copied_case_only';
            item_resolution := 'auto_resolved';
        ELSIF btrim(COALESCE(current_text, '')) = btrim(source_row.aktuelle_anamnese) THEN
            item_classification := 'exact_match';
            item_resolution := 'auto_resolved';
        ELSIF NULLIF(btrim(COALESCE(current_text, '')), '') IS NULL THEN
            UPDATE patient_clinical_narrative
            SET anamnese_aktuelle = btrim(source_row.aktuelle_anamnese),
                case_id = COALESCE(case_id, source_row.id)
            WHERE id = target_id;
            item_classification := 'copied_case_only';
            item_resolution := 'auto_resolved';
        ELSE
            item_classification := 'preserved_conflict';
            item_resolution := 'pending';
        END IF;

        INSERT INTO case_clinical_reconciliation_items (
            source_table, source_row_id, case_id, patient_id,
            target_table, target_row_id, classification, resolution_status,
            source_payload, target_payload
        ) VALUES (
            'cases.aktuelle_anamnese', source_row.id, source_row.id, source_row.patient_id,
            'patient_clinical_narrative', target_id, item_classification, item_resolution,
            jsonb_build_object('aktuelle_anamnese', source_row.aktuelle_anamnese),
            (SELECT to_jsonb(n) FROM patient_clinical_narrative n
             WHERE n.patient_id = source_row.patient_id)
        ) ON CONFLICT (source_table, source_row_id) DO NOTHING;
    END LOOP;

    FOR source_row IN
        SELECT va.*, c.patient_id, c.created_at AS case_created_at, c.case_id AS case_number
        FROM vegetative_anamnese va
        JOIN cases c ON c.id = va.case_id
    LOOP
        target_id := NULL;
        narrative_id := NULL;
        vegetative_text := NULLIF(btrim(concat_ws(E'\n',
            CASE WHEN NULLIF(btrim(COALESCE(source_row.appetit_durst, '')), '') IS NOT NULL
                 THEN 'Appetit/Durst: ' || btrim(source_row.appetit_durst) END,
            CASE WHEN NULLIF(btrim(COALESCE(source_row.gewichtsveraenderung, '')), '') IS NOT NULL
                 THEN 'Gewichtsveränderung: ' || btrim(source_row.gewichtsveraenderung) END,
            CASE WHEN NULLIF(btrim(COALESCE(source_row.grund, '')), '') IS NOT NULL
                 THEN 'Grund: ' || btrim(source_row.grund) END
        )), '');

        IF source_row.patient_id IS NOT NULL
           AND (source_row.gewicht > 0 OR source_row.koerpergroesse > 0) THEN
            SELECT pv.id INTO target_id
            FROM patient_vital_measurements pv
            WHERE pv.patient_id = source_row.patient_id
              AND pv.weight_kg IS NOT DISTINCT FROM
                  CASE WHEN source_row.gewicht > 0 THEN source_row.gewicht::float8 END
              AND pv.height_cm IS NOT DISTINCT FROM
                  CASE WHEN source_row.koerpergroesse > 0 THEN source_row.koerpergroesse::float8 END
            ORDER BY pv.created_at, pv.id LIMIT 1;

            IF target_id IS NULL THEN
                INSERT INTO patient_vital_measurements (
                    patient_id, measured_at, weight_kg, height_cm, notes
                ) VALUES (
                    source_row.patient_id, source_row.case_created_at,
                    CASE WHEN source_row.gewicht > 0 THEN source_row.gewicht::float8 END,
                    CASE WHEN source_row.koerpergroesse > 0 THEN source_row.koerpergroesse::float8 END,
                    'Übernommen aus Fall-Intake ' || source_row.case_number
                ) RETURNING id INTO target_id;
                item_classification := 'copied_case_only';
            ELSE
                item_classification := 'exact_match';
            END IF;
            item_resolution := 'auto_resolved';
        ELSIF source_row.patient_id IS NULL THEN
            item_classification := 'unmapped_subject';
            item_resolution := 'pending';
        ELSE
            item_classification := 'copied_case_only';
            item_resolution := 'auto_resolved';
        END IF;

        IF source_row.patient_id IS NOT NULL AND vegetative_text IS NOT NULL THEN
            SELECT n.id, n.anamnese_vegetative
            INTO narrative_id, current_text
            FROM patient_clinical_narrative n
            WHERE n.patient_id = source_row.patient_id
              AND n.is_active;

            IF NOT FOUND THEN
                INSERT INTO patient_clinical_narrative (
                    patient_id, case_id, anamnese_vegetative, is_active
                ) VALUES (
                    source_row.patient_id, source_row.case_id,
                    vegetative_text, true
                ) RETURNING id INTO narrative_id;
            ELSIF NULLIF(btrim(COALESCE(current_text, '')), '') IS NULL THEN
                UPDATE patient_clinical_narrative
                SET anamnese_vegetative = vegetative_text,
                    case_id = COALESCE(case_id, source_row.case_id)
                WHERE id = narrative_id;
            ELSIF btrim(current_text) <> vegetative_text THEN
                item_classification := 'preserved_conflict';
                item_resolution := 'pending';
            END IF;
        END IF;

        INSERT INTO case_clinical_reconciliation_items (
            source_table, source_row_id, case_id, patient_id,
            target_table, target_row_id, classification, resolution_status,
            source_payload, target_payload
        ) VALUES (
            'vegetative_anamnese', source_row.id, source_row.case_id, source_row.patient_id,
            CASE
                WHEN target_id IS NOT NULL THEN 'patient_vital_measurements'
                WHEN narrative_id IS NOT NULL THEN 'patient_clinical_narrative'
            END,
            COALESCE(target_id, narrative_id), item_classification, item_resolution,
            to_jsonb(source_row) - ARRAY['patient_id', 'case_created_at', 'case_number'],
            jsonb_strip_nulls(jsonb_build_object(
                'vital_measurement', (SELECT to_jsonb(pv) FROM patient_vital_measurements pv WHERE pv.id = target_id),
                'clinical_narrative', (SELECT to_jsonb(n) FROM patient_clinical_narrative n WHERE n.id = narrative_id)
            ))
        ) ON CONFLICT (source_table, source_row_id) DO NOTHING;
    END LOOP;

    FOR source_row IN
        SELECT i.*, c.patient_id
        FROM impfstatus i
        JOIN cases c ON c.id = i.case_id
    LOOP
        IF source_row.patient_id IS NULL THEN
            item_classification := 'unmapped_subject';
            item_resolution := 'pending';
            target_id := NULL;
        ELSE
            SELECT p.patient_id, p.status_text
            INTO target_id, current_text
            FROM patient_impfstatus p
            WHERE p.patient_id = source_row.patient_id;

            IF NOT FOUND THEN
                INSERT INTO patient_impfstatus (patient_id, status_text)
                VALUES (source_row.patient_id, source_row.status_text);
                target_id := source_row.patient_id;
                item_classification := 'copied_case_only';
                item_resolution := 'auto_resolved';
            ELSIF current_text IS NOT DISTINCT FROM source_row.status_text THEN
                item_classification := 'exact_match';
                item_resolution := 'auto_resolved';
            ELSE
                item_classification := 'preserved_conflict';
                item_resolution := 'pending';
            END IF;
        END IF;

        INSERT INTO case_clinical_reconciliation_items (
            source_table, source_row_id, case_id, patient_id,
            target_table, target_row_id, classification, resolution_status,
            source_payload, target_payload
        ) VALUES (
            'impfstatus', source_row.id, source_row.case_id, source_row.patient_id,
            CASE WHEN target_id IS NOT NULL THEN 'patient_impfstatus' END,
            target_id, item_classification, item_resolution,
            to_jsonb(source_row) - 'patient_id',
            (SELECT to_jsonb(p) FROM patient_impfstatus p
             WHERE p.patient_id = source_row.patient_id)
        ) ON CONFLICT (source_table, source_row_id) DO NOTHING;
    END LOOP;
END $$;

-- Copy pharma links only through the UUID mapping above. Existing differing
-- patient-side rows remain untouched and are explicit pending conflicts.
DO $$
DECLARE
    source_row RECORD;
    target_id UUID;
    candidate_id UUID;
    item_classification TEXT;
    item_resolution TEXT;
BEGIN
    FOR source_row IN
        SELECT mdm.*, lm.case_id AS mapped_case_id, lm.patient_id AS mapped_patient_id,
               lm.patient_medication_id AS mapped_patient_medication_id
        FROM medication_drug_matches mdm
        LEFT JOIN legacy_medication_patient_map lm
          ON lm.legacy_medication_id = mdm.medication_id
        WHERE mdm.patient_medication_id IS NULL
    LOOP
        target_id := NULL;
        candidate_id := NULL;
        IF source_row.mapped_patient_medication_id IS NULL THEN
            item_classification := 'unmapped_subject';
            item_resolution := 'pending';
        ELSE
            SELECT m.id INTO target_id
            FROM medication_drug_matches m
            WHERE m.patient_medication_id = source_row.mapped_patient_medication_id
              AND m.drug_product_id = source_row.drug_product_id
              AND m.match_kind = source_row.match_kind
              AND m.confidence = source_row.confidence
              AND m.verification_status = source_row.verification_status
              AND m.note IS NOT DISTINCT FROM source_row.note
              AND m.created_by IS NOT DISTINCT FROM source_row.created_by
              AND m.verified_by IS NOT DISTINCT FROM source_row.verified_by
              AND m.verified_at IS NOT DISTINCT FROM source_row.verified_at
            ORDER BY m.created_at, m.id LIMIT 1;

            IF target_id IS NOT NULL THEN
                item_classification := 'exact_match';
                item_resolution := 'auto_resolved';
            ELSE
                SELECT m.id INTO candidate_id
                FROM medication_drug_matches m
                WHERE m.patient_medication_id = source_row.mapped_patient_medication_id
                  AND m.drug_product_id = source_row.drug_product_id
                ORDER BY m.created_at, m.id LIMIT 1;

                IF candidate_id IS NOT NULL THEN
                    target_id := candidate_id;
                    item_classification := 'preserved_conflict';
                    item_resolution := 'pending';
                ELSE
                    INSERT INTO medication_drug_matches (
                        case_id, medication_id, patient_medication_id,
                        drug_product_id, match_kind, confidence,
                        verification_status, note, created_by,
                        verified_by, verified_at, created_at, updated_at
                    ) VALUES (
                        NULL, NULL, source_row.mapped_patient_medication_id,
                        source_row.drug_product_id, source_row.match_kind,
                        source_row.confidence, source_row.verification_status,
                        source_row.note, source_row.created_by,
                        source_row.verified_by, source_row.verified_at,
                        source_row.created_at, source_row.updated_at
                    ) RETURNING id INTO target_id;
                    item_classification := 'copied_case_only';
                    item_resolution := 'auto_resolved';
                END IF;
            END IF;
        END IF;

        INSERT INTO case_clinical_reconciliation_items (
            source_table, source_row_id, case_id, patient_id,
            target_table, target_row_id, classification, resolution_status,
            source_payload, target_payload
        ) VALUES (
            'medication_drug_matches', source_row.id,
            COALESCE(source_row.mapped_case_id, source_row.case_id),
            source_row.mapped_patient_id,
            CASE WHEN target_id IS NOT NULL THEN 'medication_drug_matches' END,
            target_id, item_classification, item_resolution,
            to_jsonb(source_row) - ARRAY['mapped_case_id', 'mapped_patient_id', 'mapped_patient_medication_id'],
            (SELECT to_jsonb(m) FROM medication_drug_matches m WHERE m.id = target_id)
        ) ON CONFLICT (source_table, source_row_id) DO NOTHING;
    END LOOP;

    FOR source_row IN
        SELECT mee.*, lm.case_id AS mapped_case_id, lm.patient_id AS mapped_patient_id,
               lm.patient_medication_id AS mapped_patient_medication_id
        FROM medication_expiry_events mee
        LEFT JOIN legacy_medication_patient_map lm
          ON lm.legacy_medication_id = mee.medication_id
        WHERE mee.patient_medication_id IS NULL
    LOOP
        target_id := NULL;
        candidate_id := NULL;
        IF source_row.mapped_patient_medication_id IS NULL THEN
            item_classification := 'unmapped_subject';
            item_resolution := 'pending';
        ELSE
            SELECT e.id INTO target_id
            FROM medication_expiry_events e
            WHERE e.patient_medication_id = source_row.mapped_patient_medication_id
              AND e.expiry_date = source_row.expiry_date
              AND e.status = source_row.status
              AND e.notification_sent_at = source_row.notification_sent_at
              AND e.confirmed_at IS NOT DISTINCT FROM source_row.confirmed_at
              AND e.confirmed_by IS NOT DISTINCT FROM source_row.confirmed_by
              AND e.note IS NOT DISTINCT FROM source_row.note
            ORDER BY e.created_at, e.id LIMIT 1;

            IF target_id IS NOT NULL THEN
                item_classification := 'exact_match';
                item_resolution := 'auto_resolved';
            ELSE
                IF source_row.status = 'pending_confirmation' THEN
                    SELECT e.id INTO candidate_id
                    FROM medication_expiry_events e
                    WHERE e.patient_medication_id = source_row.mapped_patient_medication_id
                      AND e.status = 'pending_confirmation'
                    ORDER BY e.created_at, e.id LIMIT 1;
                END IF;

                IF candidate_id IS NOT NULL THEN
                    target_id := candidate_id;
                    item_classification := 'preserved_conflict';
                    item_resolution := 'pending';
                ELSE
                    INSERT INTO medication_expiry_events (
                        medication_id, case_id, patient_medication_id, patient_id,
                        expiry_date, status, notification_sent_at,
                        confirmed_at, confirmed_by, note, created_at, updated_at
                    ) VALUES (
                        NULL, NULL, source_row.mapped_patient_medication_id,
                        source_row.mapped_patient_id, source_row.expiry_date,
                        source_row.status, source_row.notification_sent_at,
                        source_row.confirmed_at, source_row.confirmed_by,
                        source_row.note, source_row.created_at, source_row.updated_at
                    ) RETURNING id INTO target_id;
                    item_classification := 'copied_case_only';
                    item_resolution := 'auto_resolved';
                END IF;
            END IF;
        END IF;

        INSERT INTO case_clinical_reconciliation_items (
            source_table, source_row_id, case_id, patient_id,
            target_table, target_row_id, classification, resolution_status,
            source_payload, target_payload
        ) VALUES (
            'medication_expiry_events', source_row.id,
            COALESCE(source_row.mapped_case_id, source_row.case_id),
            source_row.mapped_patient_id,
            CASE WHEN target_id IS NOT NULL THEN 'medication_expiry_events' END,
            target_id, item_classification, item_resolution,
            to_jsonb(source_row) - ARRAY['mapped_case_id', 'mapped_patient_id', 'mapped_patient_medication_id'],
            (SELECT to_jsonb(e) FROM medication_expiry_events e WHERE e.id = target_id)
        ) ON CONFLICT (source_table, source_row_id) DO NOTHING;
    END LOOP;
END $$;

CREATE OR REPLACE VIEW case_clinical_reconciliation_report AS
SELECT source_table,
       classification,
       resolution_status,
       COUNT(*)::BIGINT AS item_count,
       COUNT(*) FILTER (WHERE target_row_id IS NULL)::BIGINT AS without_target_count
FROM case_clinical_reconciliation_items
GROUP BY source_table, classification, resolution_status;

COMMENT ON TABLE case_clinical_reconciliation_items IS
    'Phase 6A audit ledger. Pending rows must be manually resolved before legacy clinical storage can be removed.';
COMMENT ON TABLE legacy_medication_patient_map IS
    'Lossless UUID mapping used to carry legacy medication drug matches and expiry events to patient medications.';
