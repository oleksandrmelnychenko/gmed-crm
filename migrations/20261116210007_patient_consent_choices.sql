-- An existing patient changes the consent form options and the trusted
-- persons of the Einverständniserklärung zur Datenübermittlung (owner request
-- 2026-11-16): staff in the patient card, with how the client told them, or
-- the patient in the portal. Each change is a new row of the append-only
-- consent_form_choices, owned by the patient (lead_id NULL), next to the
-- lead's rows the patient came from.
--
-- What applies is derived from the history (consent_choices::effective_consent):
-- a removal applies at once, an addition once a consent form that records
-- the new choice is signed.
ALTER TABLE consent_form_choices DROP CONSTRAINT IF EXISTS consent_form_choices_source_check;
ALTER TABLE consent_form_choices ADD CONSTRAINT consent_form_choices_source_check
    CHECK (source IN ('lead_portal', 'staff_correction', 'staff_recorded',
                      'patient_staff', 'patient_portal'));

-- Staff in the patient card always say how the client told them.
ALTER TABLE consent_form_choices DROP CONSTRAINT IF EXISTS consent_form_choices_recorded_check;
ALTER TABLE consent_form_choices ADD CONSTRAINT consent_form_choices_recorded_check
    CHECK ((source IN ('staff_recorded', 'patient_staff')) = (recorded_how IS NOT NULL));

-- A patient's own change belongs to the patient, never to a lead.
ALTER TABLE consent_form_choices DROP CONSTRAINT IF EXISTS consent_form_choices_patient_source_check;
ALTER TABLE consent_form_choices ADD CONSTRAINT consent_form_choices_patient_source_check
    CHECK (source NOT IN ('patient_staff', 'patient_portal')
           OR (patient_id IS NOT NULL AND lead_id IS NULL));

-- The choices of a converted lead become the patient's too (the conversion
-- does the same from now on). The append-only trigger allows setting a
-- missing patient_id.
UPDATE consent_form_choices c
SET patient_id = l.converted_patient_id
FROM leads l
WHERE c.lead_id = l.id
  AND l.converted_patient_id IS NOT NULL
  AND c.patient_id IS NULL;

COMMENT ON COLUMN consent_form_choices.source IS
    'lead_portal / staff_recorded / staff_correction (lead), patient_staff (patient card, with recorded_how) or patient_portal (the patient in the portal)';

-- Integrity of the order logic (owner 2026-11-16): while the patient has an
-- open order (orders.status 'active' or 'paused'; 'completed' and
-- 'cancelled' are closed), a generated order or contract document gets no
-- MANUAL new version — framework contract, Einzelauftrag, Kostenvoranschlag,
-- VKS, Kostenübernahmeerklärung, the payer's papers and any document of an
-- order. The consent forms (Einverständniserklärung, the minor's forms) stay
-- open. A new version the order logic asks for stays possible: a document
-- whose terms no longer hold (document_terms_current = false) or whose
-- «Gültig bis» has passed or ends within 30 days.
CREATE OR REPLACE FUNCTION document_manual_version_locked(target UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE((
        SELECT d.generated_template_id IS NOT NULL
           AND d.generated_template_id NOT IN (
               'privacy_consents', 'consent_data_release_child', 'consent_data_release_single')
           AND (d.order_id IS NOT NULL
                OR d.generated_template_id IN (
                    'framework_contract', 'single_order', 'order_cost_estimate', 'cost_estimate',
                    'cost_coverage_declaration', 'payer_cost_estimate', 'patient_payer_statement'))
           AND document_terms_current(d.id) IS NOT FALSE
           -- A Kostenvoranschlag printing an earlier quote of its order is
           -- renewed for the current quote.
           AND NOT (d.generated_template_id = 'order_cost_estimate'
                    AND d.order_id IS NOT NULL
                    AND d.generated_bindings ->> '_quote_number' IS DISTINCT FROM (
                        SELECT q.quote_number FROM quotes q
                        WHERE q.order_id = d.order_id AND q.status <> 'superseded'
                        ORDER BY q.status IN ('rejected', 'expired'), q.created_at DESC, q.id DESC
                        LIMIT 1))
           AND (d.valid_until IS NULL
                OR d.valid_until > (now() AT TIME ZONE 'Europe/Berlin')::date + 30)
           AND EXISTS (
               SELECT 1 FROM orders o
               WHERE o.status IN ('active', 'paused')
                 AND (o.id = d.order_id
                      OR (d.patient_id IS NOT NULL AND o.patient_id = d.patient_id)))
        FROM documents d
        WHERE d.id = target
    ), false)
$$;
