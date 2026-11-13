-- =============================================================================
-- GMED final pass E: read-only data-consistency checks (2026-11-13)
-- =============================================================================
-- Schema: main acd38594 (migrations up to 20261113130002).
--
-- READ ONLY. Every statement is a SELECT; no DDL, no writes, no custom
-- functions (only built-in, side-effect-free ones). The session is switched to
-- read-only first, so even a mistake cannot write.
--
-- Run:   psql "<connection>" -X -P pager=off -f final-E-checks.sql
-- Each check prints ONE row:
--   check_id | n (rows found; expected 0) | sample_ids (at most 20 ids)
-- Sample ids are record ids only (uuid) - never names, addresses or numbers
-- that identify a person. The id type is named in the comment of the check.
--
-- Severity in the comments:
--   [BUG]  must be 0; a row is wrong data (a code path wrote it or failed to).
--   [WARN] should be 0; may be legacy data from before a later rule/fix, or a
--          case staff still have to finish by hand.
--   [INFO] count for the owner; not an error by itself.
-- "Today" is the Europe/Berlin calendar day, as in the server (app_time).
-- =============================================================================

\set ON_ERROR_STOP off
SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;
SET default_transaction_read_only = on;
SET statement_timeout = '120s';
SET lock_timeout = '5s';
\pset footer off

-- -----------------------------------------------------------------------------
-- A. Patient relations (parents, payers, contracting parties)
-- -----------------------------------------------------------------------------

-- A01 [BUG] The same person twice in a patient's relations (repeat-request
-- bug fixed in fix-51: converting a minor's repeat request inserted both
-- parents again). Same patient, same normalized name, parent/mother/father
-- collapsed to one kind. n = duplicate groups. Ids: patient id (patients.id).
SELECT 'A01_duplicate_relation_same_person' AS check_id, count(*) AS n,
       (array_agg(DISTINCT patient_id))[1:20] AS sample_ids
FROM (
    SELECT r.patient_id
    FROM patient_relations r
    GROUP BY r.patient_id,
             lower(regexp_replace(btrim(r.related_name), '\s+', ' ', 'g')),
             CASE WHEN r.relation_type IN ('parent', 'mother', 'father') THEN 'parent'
                  ELSE r.relation_type END
    HAVING count(*) > 1
) x;

-- A02 [BUG] Exact signature of the fix-51 bug: a relation whose
-- source_contact_id is the id of ANOTHER relation of the same patient (the
-- repeat prefill used the relation id as entry id and conversion inserted a
-- new row). Ids: patient_relations.id of the duplicate row.
SELECT 'A02_relation_copied_from_other_relation' AS check_id, count(*) AS n,
       (array_agg(r.id ORDER BY r.id))[1:20] AS sample_ids
FROM patient_relations r
WHERE r.source_contact_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM patient_relations o
              WHERE o.patient_id = r.patient_id
                AND o.id = r.source_contact_id
                AND o.id <> r.id);

-- A03 [BUG] The same linked patient record twice among one patient's
-- relations. Ids: patient id.
SELECT 'A03_duplicate_relation_same_linked_record' AS check_id, count(*) AS n,
       (array_agg(patient_id ORDER BY patient_id))[1:20] AS sample_ids
FROM (
    SELECT patient_id FROM patient_relations
    WHERE related_patient_id IS NOT NULL
    GROUP BY patient_id, related_patient_id
    HAVING count(*) > 1
) x;

-- A04 [BUG] An invoice or order names as payer a relation of ANOTHER
-- patient. Ids: invoices.id / orders.id.
SELECT 'A04_payer_relation_of_other_patient' AS check_id, count(*) AS n,
       (array_agg(id ORDER BY id))[1:20] AS sample_ids
FROM (
    SELECT i.id FROM invoices i JOIN patient_relations r ON r.id = i.payer_patient_relation_id
    WHERE r.patient_id <> i.patient_id
    UNION ALL
    SELECT o.id FROM orders o JOIN patient_relations r ON r.id = o.payer_patient_relation_id
    WHERE r.patient_id <> o.patient_id
) x;

-- A05 [BUG] contracting_relation_ids (uuid[] without a foreign key) names a
-- relation that does not exist or belongs to another patient - on the
-- patient card, an order or a framework contract. Ids: patients.id /
-- orders.id / framework_contracts.id.
SELECT 'A05_contracting_relation_dangling' AS check_id, count(*) AS n,
       (array_agg(DISTINCT id))[1:20] AS sample_ids
FROM (
    SELECT p.id FROM patients p CROSS JOIN LATERAL unnest(p.contracting_relation_ids) rid
    LEFT JOIN patient_relations r ON r.id = rid
    WHERE r.id IS NULL OR r.patient_id <> p.id
    UNION ALL
    SELECT o.id FROM orders o CROSS JOIN LATERAL unnest(o.contracting_relation_ids) rid
    LEFT JOIN patient_relations r ON r.id = rid
    WHERE r.id IS NULL OR r.patient_id <> o.patient_id
    UNION ALL
    SELECT f.id FROM framework_contracts f CROSS JOIN LATERAL unnest(f.contracting_relation_ids) rid
    LEFT JOIN patient_relations r ON r.id = rid
    WHERE r.id IS NULL OR r.patient_id <> f.patient_id
) x;

-- A06 [WARN] A minor converted with parents but without any emergency
-- contact (owner decision 2026-11-13 no. 5, fix-53: the first contracting
-- parent becomes the emergency contact at conversion). Conversions before
-- fix-53 are expected here; staff should mark one. Ids: patient id.
SELECT 'A06_minor_without_emergency_contact' AS check_id, count(*) AS n,
       (array_agg(p.id ORDER BY p.id))[1:20] AS sample_ids
FROM patients p
WHERE p.birth_date > ((now() AT TIME ZONE 'Europe/Berlin')::date - INTERVAL '18 years')::date
  AND p.lifecycle_status <> 'deleted'
  AND EXISTS (SELECT 1 FROM patient_relations r WHERE r.patient_id = p.id
              AND r.relation_type IN ('parent', 'mother', 'father', 'guardian'))
  AND NOT EXISTS (SELECT 1 FROM patient_relations r WHERE r.patient_id = p.id AND r.is_emergency_contact)
  AND NULLIF(btrim(p.emergency_contact_name), '') IS NULL;

-- -----------------------------------------------------------------------------
-- B. Portal logins of minors and parents' access after the 18th birthday
-- -----------------------------------------------------------------------------

-- B01 [BUG] A minor patient has an active OWN portal login: an active
-- assignment that is not a parent's ('lead_guardian') to an active
-- patient-role user who holds no guardian access anywhere ("a minor gets no
-- own login", patient_portal_access.rs). Ids: patient_assignments.id.
SELECT 'B01_minor_with_own_active_login' AS check_id, count(*) AS n,
       (array_agg(pa.id ORDER BY pa.id))[1:20] AS sample_ids
FROM patient_assignments pa
JOIN patients p ON p.id = pa.patient_id
JOIN users u ON u.id = pa.user_id
WHERE pa.revoked_at IS NULL
  AND pa.source <> 'lead_guardian'
  AND u.role = 'patient' AND u.is_active
  AND p.birth_date > ((now() AT TIME ZONE 'Europe/Berlin')::date - INTERVAL '18 years')::date
  AND NOT EXISTS (SELECT 1 FROM lead_portal_access a WHERE a.user_id = u.id AND a.kind = 'guardian');

-- B02 [BUG] Parents still reach an ADULT patient's record: an active
-- 'lead_guardian' assignment of a patient who turned 18 more than one day ago
-- (the daily coming-of-age job revokes it on the birthday). Ids:
-- patient_assignments.id.
SELECT 'B02_parent_assignment_after_18' AS check_id, count(*) AS n,
       (array_agg(pa.id ORDER BY pa.id))[1:20] AS sample_ids
FROM patient_assignments pa
JOIN patients p ON p.id = pa.patient_id
WHERE pa.source = 'lead_guardian' AND pa.revoked_at IS NULL
  AND p.birth_date < ((now() AT TIME ZONE 'Europe/Berlin')::date - INTERVAL '18 years' - INTERVAL '1 day')::date;

-- B03 [BUG] Parents' guardian access to a request (lead cabinet) still active
-- although the person turned 18 more than one day ago - by the request's own
-- date of birth or by the converted patient's. Ids: lead_portal_access.id.
SELECT 'B03_guardian_lead_access_after_18' AS check_id, count(*) AS n,
       (array_agg(a.id ORDER BY a.id))[1:20] AS sample_ids
FROM lead_portal_access a
JOIN leads l ON l.id = a.lead_id
LEFT JOIN patients p ON p.id = l.converted_patient_id
WHERE a.kind = 'guardian' AND a.revoked_at IS NULL
  AND l.qualification_status NOT IN ('deleted')
  AND COALESCE(p.birth_date, l.date_of_birth)
      < ((now() AT TIME ZONE 'Europe/Berlin')::date - INTERVAL '18 years' - INTERVAL '1 day')::date;

-- B04 [WARN] Active parent ('lead_guardian') assignment to a patient record
-- whose user is not a patient-role login (staff account got a parent link)
-- or is switched off. Ids: patient_assignments.id.
SELECT 'B04_guardian_assignment_bad_login' AS check_id, count(*) AS n,
       (array_agg(pa.id ORDER BY pa.id))[1:20] AS sample_ids
FROM patient_assignments pa JOIN users u ON u.id = pa.user_id
WHERE pa.source = 'lead_guardian' AND pa.revoked_at IS NULL
  AND (u.role <> 'patient' OR NOT u.is_active);

-- B05 [BUG] A patient-role login with an active assignment to more than one
-- patient through a non-parent link ('manual'): a patient's own login must
-- reach exactly its own record. Ids: users.id.
SELECT 'B05_own_login_on_several_patients' AS check_id, count(*) AS n,
       (array_agg(user_id ORDER BY user_id))[1:20] AS sample_ids
FROM (
    SELECT pa.user_id FROM patient_assignments pa JOIN users u ON u.id = pa.user_id
    WHERE u.role = 'patient' AND pa.revoked_at IS NULL AND pa.source = 'manual'
    GROUP BY pa.user_id HAVING count(*) > 1
) x;

-- -----------------------------------------------------------------------------
-- C. Leads and conversion
-- -----------------------------------------------------------------------------

-- C01 [BUG] Conversion state contradicts itself: status 'converted' without a
-- patient, or a patient link on a lead that is not 'converted' (a converted
-- lead is frozen, lead_converted 409). Ids: leads.id.
SELECT 'C01_lead_conversion_state_mismatch' AS check_id, count(*) AS n,
       (array_agg(id ORDER BY id))[1:20] AS sample_ids
FROM leads
WHERE (qualification_status = 'converted' AND converted_patient_id IS NULL)
   OR (qualification_status <> 'converted' AND converted_patient_id IS NOT NULL);

-- C02 [BUG] More than one FIRST request (not a repeat request) converted into
-- the same patient - a lead converted twice / two first requests merged.
-- Ids: patient id.
SELECT 'C02_patient_with_two_first_requests' AS check_id, count(*) AS n,
       (array_agg(converted_patient_id ORDER BY converted_patient_id))[1:20] AS sample_ids
FROM (
    SELECT converted_patient_id FROM leads
    WHERE converted_patient_id IS NOT NULL AND repeat_patient_id IS NULL
    GROUP BY converted_patient_id HAVING count(*) > 1
) x;

-- C03 [BUG] patients.source_lead_id names a lead that converted into (or was
-- opened for) another patient. Ids: patients.id.
SELECT 'C03_patient_source_lead_points_elsewhere' AS check_id, count(*) AS n,
       (array_agg(p.id ORDER BY p.id))[1:20] AS sample_ids
FROM patients p JOIN leads l ON l.id = p.source_lead_id
WHERE l.converted_patient_id IS DISTINCT FROM p.id
  AND l.prospect_patient_id IS DISTINCT FROM p.id
  AND l.repeat_patient_id IS DISTINCT FROM p.id;

-- C04 [WARN] A patient a first request converted into, but whose
-- source_lead_id is empty or names another lead (patient without its lead
-- link). Ids: patients.id.
SELECT 'C04_converted_patient_without_lead_link' AS check_id, count(*) AS n,
       (array_agg(DISTINCT p.id))[1:20] AS sample_ids
FROM leads l JOIN patients p ON p.id = l.converted_patient_id
WHERE l.repeat_patient_id IS NULL
  AND p.source_lead_id IS DISTINCT FROM l.id;

-- C05 [BUG] A converted request whose prospect record (patient opened at lead
-- creation) is not the record it converted into: one person, two patient
-- records. Ids: leads.id.
SELECT 'C05_prospect_differs_from_converted' AS check_id, count(*) AS n,
       (array_agg(id ORDER BY id))[1:20] AS sample_ids
FROM leads
WHERE converted_patient_id IS NOT NULL AND prospect_patient_id IS NOT NULL
  AND prospect_patient_id <> converted_patient_id;

-- C06 [BUG] A repeat request converted into a different patient than the one
-- it was opened for. Ids: leads.id.
SELECT 'C06_repeat_converted_into_other_patient' AS check_id, count(*) AS n,
       (array_agg(id ORDER BY id))[1:20] AS sample_ids
FROM leads
WHERE repeat_patient_id IS NOT NULL AND converted_patient_id IS NOT NULL
  AND repeat_patient_id <> converted_patient_id;

-- C07 [BUG] Audit gap: a converted request without its 'convert_lead' audit
-- row (conversion is audited in its transaction). Ids: leads.id.
SELECT 'C07_converted_lead_without_audit' AS check_id, count(*) AS n,
       (array_agg(l.id ORDER BY l.id))[1:20] AS sample_ids
FROM leads l
WHERE l.converted_patient_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM audit_log a
                  WHERE a.action = 'convert_lead' AND a.entity_type = 'lead' AND a.entity_id = l.id);

-- C08 [WARN] Identity data of a parent/representative on a request with
-- neither a staff author nor a client time (fix-51: staff saves in the
-- client's form were stored without attribution). Ids: lead_representatives
-- contact_id.
SELECT 'C08_representative_id_data_unattributed' AS check_id, count(*) AS n,
       (array_agg(contact_id ORDER BY contact_id))[1:20] AS sample_ids
FROM lead_representatives
WHERE NULLIF(btrim(id_document_number), '') IS NOT NULL
  AND id_data_entered_by IS NULL AND id_data_client_at IS NULL;

-- C09 [BUG] fix-52: 'informed via link' must carry a time and no staff
-- author. Ids: lead_payer_declarations.lead_id.
SELECT 'C09_payer_informed_via_inconsistent' AS check_id, count(*) AS n,
       (array_agg(lead_id ORDER BY lead_id))[1:20] AS sample_ids
FROM lead_payer_declarations
WHERE payer_informed_via IS NOT NULL
  AND (payer_informed_at IS NULL OR payer_informed_by IS NOT NULL);

-- C10 [BUG] Consent of a request recorded on another patient than the one
-- the request converted into (or was opened for). Ids: consent_records.id.
SELECT 'C10_consent_on_other_patient' AS check_id, count(*) AS n,
       (array_agg(c.id ORDER BY c.id))[1:20] AS sample_ids
FROM consent_records c JOIN leads l ON l.id = c.lead_id
WHERE c.patient_id IS NOT NULL
  AND c.patient_id IS DISTINCT FROM l.converted_patient_id
  AND c.patient_id IS DISTINCT FROM l.prospect_patient_id
  AND c.patient_id IS DISTINCT FROM l.repeat_patient_id;

-- C11 [BUG] Document of a request filed under a patient that is not the
-- request's patient (converted / prospect / repeat). Ids: documents.id.
SELECT 'C11_lead_document_on_other_patient' AS check_id, count(*) AS n,
       (array_agg(d.id ORDER BY d.id))[1:20] AS sample_ids
FROM documents d JOIN leads l ON l.id = d.lead_id
WHERE d.patient_id IS NOT NULL
  AND d.patient_id IS DISTINCT FROM l.converted_patient_id
  AND d.patient_id IS DISTINCT FROM l.prospect_patient_id
  AND d.patient_id IS DISTINCT FROM l.repeat_patient_id;

-- C12 [WARN] One person twice in a request's trusted contacts / parents
-- (same normalized name, parent kinds collapsed). Seen on a minor's repeat
-- request before fix d9176108 (prefill + save stored both parents twice);
-- converting such a request is what A01/A02 catch afterwards. Deleted
-- requests are skipped. Ids: leads.id.
SELECT 'C12_request_with_duplicate_contact' AS check_id, count(*) AS n,
       (array_agg(id ORDER BY id))[1:20] AS sample_ids
FROM (SELECT DISTINCT id FROM (
    SELECT l.id
    FROM leads l
    CROSS JOIN LATERAL jsonb_array_elements(l.trusted_contacts) c
    WHERE l.qualification_status <> 'deleted'
      AND NULLIF(btrim(c ->> 'name'), '') IS NOT NULL
    GROUP BY l.id,
             lower(regexp_replace(btrim(c ->> 'name'), '\s+', ' ', 'g')),
             CASE WHEN c ->> 'relation' IN ('parent', 'mother', 'father') THEN 'parent'
                  ELSE COALESCE(c ->> 'relation', '') END
    HAVING count(*) > 1
) y) x;

-- -----------------------------------------------------------------------------
-- D. Concierge services, their tasks and their invoice lines (fix-44)
-- -----------------------------------------------------------------------------

-- D01 [BUG] Service 'billed' through invoice lines that are ALL on cancelled
-- invoices: the Storno should have moved it back to 'ready'. Ids:
-- concierge_services.id.
SELECT 'D01_billed_only_by_cancelled_invoice' AS check_id, count(*) AS n,
       (array_agg(s.id ORDER BY s.id))[1:20] AS sample_ids
FROM concierge_services s
WHERE s.billing_status = 'billed'
  AND EXISTS (SELECT 1 FROM invoice_concierge_service_lines l WHERE l.concierge_service_id = s.id)
  AND NOT EXISTS (SELECT 1 FROM invoice_concierge_service_lines l JOIN invoices i ON i.id = l.invoice_id
                  WHERE l.concierge_service_id = s.id AND i.status <> 'cancelled');

-- D02 [INFO] Service 'billed'/'settled' without any invoice line link: marked
-- billed by hand (before F-C8 or "вручную отмечено как выставленное"); not
-- counted in revenue. Ids: concierge_services.id.
SELECT 'D02_billed_without_invoice_line' AS check_id, count(*) AS n,
       (array_agg(s.id ORDER BY s.id))[1:20] AS sample_ids
FROM concierge_services s
WHERE s.billing_status IN ('billed', 'settled')
  AND NOT EXISTS (SELECT 1 FROM invoice_concierge_service_lines l WHERE l.concierge_service_id = s.id);

-- D03 [BUG] Service still 'draft'/'ready'/'waived' although a RELEASED,
-- non-cancelled invoice bills it (release should move ready -> billed).
-- Ids: concierge_services.id.
SELECT 'D03_released_invoice_service_not_billed' AS check_id, count(*) AS n,
       (array_agg(DISTINCT s.id))[1:20] AS sample_ids
FROM concierge_services s
JOIN invoice_concierge_service_lines l ON l.concierge_service_id = s.id
JOIN invoices i ON i.id = l.invoice_id
WHERE i.status NOT IN ('draft', 'cancelled')
  AND s.billing_status IN ('draft', 'ready', 'waived');

-- D04 [BUG] One service on more than one non-cancelled invoice (billed
-- twice). Ids: concierge_services.id.
SELECT 'D04_service_on_two_live_invoices' AS check_id, count(*) AS n,
       (array_agg(concierge_service_id ORDER BY concierge_service_id))[1:20] AS sample_ids
FROM (
    SELECT l.concierge_service_id
    FROM invoice_concierge_service_lines l JOIN invoices i ON i.id = l.invoice_id
    WHERE i.status <> 'cancelled'
    GROUP BY l.concierge_service_id HAVING count(*) > 1
) x;

-- D05 [BUG] Invoice line link to a service of another patient, another order
-- (the service's order is its own order_id, else its appointment's order, as
-- in invoices/concierge_lines.rs) or another currency. Ids:
-- invoice_concierge_service_lines.id.
SELECT 'D05_service_line_other_patient_order_currency' AS check_id, count(*) AS n,
       (array_agg(l.id ORDER BY l.id))[1:20] AS sample_ids
FROM invoice_concierge_service_lines l
JOIN invoices i ON i.id = l.invoice_id
JOIN concierge_services s ON s.id = l.concierge_service_id
LEFT JOIN appointments a ON a.id = s.appointment_id
WHERE s.patient_id <> i.patient_id
   OR (COALESCE(s.order_id, a.order_id) IS NOT NULL
       AND COALESCE(s.order_id, a.order_id) IS DISTINCT FROM i.order_id)
   OR upper(COALESCE(s.currency, i.currency)) <> upper(i.currency);

-- D06 [BUG] The link row and the invoice's JSON line disagree: the line index
-- does not exist, the line names another service, or its amounts differ.
-- Ids: invoice_concierge_service_lines.id.
SELECT 'D06_service_link_vs_invoice_line_mismatch' AS check_id, count(*) AS n,
       (array_agg(l.id ORDER BY l.id))[1:20] AS sample_ids
FROM invoice_concierge_service_lines l
JOIN invoices i ON i.id = l.invoice_id
LEFT JOIN LATERAL (SELECT i.line_items -> l.invoice_line_index AS li) j ON true
WHERE j.li IS NULL
   OR (j.li ->> 'source_concierge_service_id') IS DISTINCT FROM l.concierge_service_id::text
   OR abs(COALESCE(NULLIF(j.li ->> 'line_gross', '')::numeric, -1) - l.amount_gross) > 0.01
   OR abs(COALESCE(NULLIF(j.li ->> 'line_net', '')::numeric, -1) - l.amount_net) > 0.01;

-- D07 [BUG] An invoice JSON line names a concierge service but has no link
-- row (the service could be billed again). Ids: invoices.id.
SELECT 'D07_invoice_service_line_without_link' AS check_id, count(*) AS n,
       (array_agg(DISTINCT i.id))[1:20] AS sample_ids
FROM invoices i
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(i.line_items) = 'array'
                                             THEN i.line_items ELSE '[]'::jsonb END)
     WITH ORDINALITY AS li(item, pos)
WHERE NULLIF(li.item ->> 'source_concierge_service_id', '') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM invoice_concierge_service_lines l
                  WHERE l.invoice_id = i.id AND l.invoice_line_index = li.pos - 1);

-- D08 [BUG] Service status contradicts its canonical task (the task is the
-- single source of truth, migration 20260928212000): task completed ->
-- service completed, task cancelled -> service cancelled, otherwise the
-- service is neither. Ids: concierge_services.id.
SELECT 'D08_service_status_vs_task' AS check_id, count(*) AS n,
       (array_agg(s.id ORDER BY s.id))[1:20] AS sample_ids
FROM concierge_services s
JOIN LATERAL (
    SELECT t.status FROM tasks t
    WHERE t.concierge_service_id = s.id AND t.deleted_at IS NULL
      AND t.task_scope IN ('general', 'concierge_operational')
    ORDER BY (t.task_scope = 'concierge_operational') DESC, t.created_at, t.id
    LIMIT 1
) t ON true
WHERE NOT CASE WHEN t.status = 'completed' THEN s.status = 'completed'
               WHEN t.status = 'cancelled' THEN s.status = 'cancelled'
               ELSE s.status NOT IN ('completed', 'cancelled') END;

-- D09 [BUG] Open task for a cancelled service (any live task of the service,
-- including sub-tasks, still open/in progress/on hold/review). Ids: tasks.id.
SELECT 'D09_open_task_of_cancelled_service' AS check_id, count(*) AS n,
       (array_agg(t.id ORDER BY t.id))[1:20] AS sample_ids
FROM tasks t JOIN concierge_services s ON s.id = t.concierge_service_id
WHERE s.status = 'cancelled' AND t.deleted_at IS NULL
  AND t.status IN ('open', 'in_progress', 'on_hold', 'review');

-- D10 [WARN] Active concierge service (planned..in_service) of a CANCELLED
-- order (its own order_id, else its appointment's order) that nobody was
-- asked to decide on (booking_decision_required_at empty). cancel_order
-- cancels order lines, upcoming visits (whose cancellation closes or flags
-- their services) and checklist items, but never touches a service linked
-- DIRECTLY to the order (orders.rs cancel_order_in_tx). Ids:
-- concierge_services.id.
SELECT 'D10_active_service_of_cancelled_order' AS check_id, count(*) AS n,
       (array_agg(s.id ORDER BY s.id))[1:20] AS sample_ids
FROM concierge_services s
LEFT JOIN appointments a ON a.id = s.appointment_id
JOIN orders o ON o.id = COALESCE(s.order_id, a.order_id)
WHERE o.status = 'cancelled'
  AND s.status IN ('planned', 'booked', 'confirmed', 'in_service')
  AND s.booking_decision_required_at IS NULL;

-- D11 [BUG] Concierge service linked to an order or appointment of another
-- patient. Ids: concierge_services.id.
SELECT 'D11_service_order_or_visit_of_other_patient' AS check_id, count(*) AS n,
       (array_agg(s.id ORDER BY s.id))[1:20] AS sample_ids
FROM concierge_services s
LEFT JOIN orders o ON o.id = s.order_id
LEFT JOIN appointments a ON a.id = s.appointment_id
WHERE (o.id IS NOT NULL AND o.patient_id <> s.patient_id)
   OR (a.id IS NOT NULL AND a.patient_id <> s.patient_id);

-- D12 [BUG] Concierge receipt (expense) booked on another patient's service,
-- order or task. Ids: concierge_expense_submissions.id.
SELECT 'D12_expense_of_other_patient' AS check_id, count(*) AS n,
       (array_agg(e.id ORDER BY e.id))[1:20] AS sample_ids
FROM concierge_expense_submissions e
LEFT JOIN concierge_services s ON s.id = e.concierge_service_id
LEFT JOIN orders o ON o.id = e.order_id
WHERE (s.id IS NOT NULL AND e.patient_id IS NOT NULL AND s.patient_id <> e.patient_id)
   OR (o.id IS NOT NULL AND e.patient_id IS NOT NULL AND o.patient_id <> e.patient_id);

-- D13 [BUG] Cancelled service still billed on a live released invoice
-- without the billing reversal (cancelling a billed service must go through
-- "reverse billing", which sets billing_status 'reversed' and credits the
-- line). Ids: concierge_services.id.
SELECT 'D13_cancelled_service_on_live_invoice' AS check_id, count(*) AS n,
       (array_agg(DISTINCT s.id))[1:20] AS sample_ids
FROM concierge_services s
JOIN invoice_concierge_service_lines l ON l.concierge_service_id = s.id
JOIN invoices i ON i.id = l.invoice_id
WHERE s.status = 'cancelled'
  AND i.status NOT IN ('draft', 'cancelled')
  AND s.billing_status <> 'reversed';

-- -----------------------------------------------------------------------------
-- E. Invoices, payments, credit notes
-- -----------------------------------------------------------------------------

-- E01 [BUG] Invoice header totals differ from the sum of its lines
-- (line_net / line_vat / line_gross; legacy lines with only "gross" compare
-- the gross). Tolerance 0.01 per line for rounding. Ids: invoices.id.
SELECT 'E01_invoice_totals_vs_lines' AS check_id, count(*) AS n,
       (array_agg(id ORDER BY id))[1:20] AS sample_ids
FROM (
    SELECT i.id, i.total_net, i.total_vat, i.total_gross,
           count(*) AS lines,
           bool_and(li ? 'line_net') AS typed,
           sum(NULLIF(li ->> 'line_net', '')::numeric) AS net,
           sum(NULLIF(li ->> 'line_vat', '')::numeric) AS vat,
           sum(COALESCE(NULLIF(li ->> 'line_gross', ''), NULLIF(li ->> 'gross', ''),
                        NULLIF(li ->> 'total_gross', ''))::numeric) AS gross
    FROM invoices i
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(i.line_items) = 'array'
                                                 THEN i.line_items ELSE '[]'::jsonb END) li
    GROUP BY i.id
) x
WHERE abs(COALESCE(gross, 0) - total_gross) > 0.01 * lines
   OR (typed AND (abs(COALESCE(net, 0) - total_net) > 0.01 * lines
                  OR abs(COALESCE(vat, 0) - total_vat) > 0.01 * lines));

-- E02 [BUG] Header itself inconsistent: net + VAT <> gross. Ids: invoices.id.
SELECT 'E02_invoice_net_plus_vat_ne_gross' AS check_id, count(*) AS n,
       (array_agg(id ORDER BY id))[1:20] AS sample_ids
FROM invoices
WHERE abs(total_net + total_vat - total_gross) > 0.01;

-- E03 [BUG] Stored paid_amount differs from the transactions:
-- max(payments - reversals - refunds, 0) as recompute_invoice_settlement_status
-- computes it. Ids: invoices.id.
SELECT 'E03_paid_amount_vs_transactions' AS check_id, count(*) AS n,
       (array_agg(i.id ORDER BY i.id))[1:20] AS sample_ids
FROM invoices i
LEFT JOIN LATERAL (
    SELECT COALESCE(sum(CASE WHEN transaction_type = 'payment' THEN amount_gross ELSE -amount_gross END), 0) AS cash
    FROM invoice_payment_transactions WHERE invoice_id = i.id
) p ON true
LEFT JOIN LATERAL (
    SELECT COALESCE(sum(amount_gross), 0) AS refunded
    FROM invoice_refund_transactions WHERE invoice_id = i.id AND transaction_type = 'refund'
) r ON true
WHERE (EXISTS (SELECT 1 FROM invoice_payment_transactions WHERE invoice_id = i.id)
       OR EXISTS (SELECT 1 FROM invoice_refund_transactions WHERE invoice_id = i.id))
  AND abs(i.paid_amount - GREATEST(p.cash - r.refunded, 0)) > 0.005;

-- E04 [BUG] Stored credited_amount differs from credit notes minus their
-- reversals. Ids: invoices.id.
SELECT 'E04_credited_amount_vs_credit_notes' AS check_id, count(*) AS n,
       (array_agg(i.id ORDER BY i.id))[1:20] AS sample_ids
FROM invoices i
LEFT JOIN LATERAL (
    SELECT COALESCE(sum(CASE WHEN transaction_type = 'credit_note' THEN amount_gross ELSE -amount_gross END), 0) AS credited
    FROM invoice_credit_note_transactions WHERE invoice_id = i.id
) c ON true
WHERE abs(i.credited_amount - c.credited) > 0.005;

-- E05 [BUG] Credit notes (net of reversals) exceed the invoice's gross.
-- Ids: invoices.id.
SELECT 'E05_credit_notes_exceed_invoice' AS check_id, count(*) AS n,
       (array_agg(i.id ORDER BY i.id))[1:20] AS sample_ids
FROM invoices i
JOIN LATERAL (
    SELECT sum(CASE WHEN transaction_type = 'credit_note' THEN amount_gross ELSE -amount_gross END) AS credited
    FROM invoice_credit_note_transactions WHERE invoice_id = i.id
) c ON true
WHERE c.credited > i.total_gross + 0.005;

-- E06 [BUG] Stored prepayment_applied_amount differs from the live advance
-- allocations to the invoice. Ids: invoices.id.
SELECT 'E06_prepayment_applied_vs_allocations' AS check_id, count(*) AS n,
       (array_agg(i.id ORDER BY i.id))[1:20] AS sample_ids
FROM invoices i
LEFT JOIN LATERAL (
    SELECT COALESCE(sum(amount_gross), 0) AS applied
    FROM invoice_prepayment_allocations WHERE target_invoice_id = i.id
) a ON true
WHERE abs(i.prepayment_applied_amount - a.applied) > 0.005;

-- E07 [BUG] An advance invoice passed on (allocated) more than it received:
-- allocations out > paid_amount of the advance. Ids: invoices.id (advance).
SELECT 'E07_advance_allocated_more_than_paid' AS check_id, count(*) AS n,
       (array_agg(i.id ORDER BY i.id))[1:20] AS sample_ids
FROM invoices i
JOIN LATERAL (
    SELECT sum(amount_gross) AS allocated
    FROM invoice_prepayment_allocations WHERE advance_invoice_id = i.id
) a ON true
WHERE a.allocated > i.paid_amount + 0.005;

-- E08 [BUG] Status contradicts the money (same rule as the server):
-- settled = paid_amount + prepayment_applied >= total_gross - credited.
-- 'paid' while not settled, or sent/partially_paid/overdue while settled
-- (with a positive amount due). Ids: invoices.id.
SELECT 'E08_invoice_status_vs_settlement' AS check_id, count(*) AS n,
       (array_agg(id ORDER BY id))[1:20] AS sample_ids
FROM invoices
WHERE (status = 'paid'
       AND paid_amount + prepayment_applied_amount < total_gross - credited_amount - 0.005)
   OR (status IN ('sent', 'partially_paid', 'overdue')
       AND total_gross - credited_amount > 0
       AND paid_amount + prepayment_applied_amount >= total_gross - credited_amount)
   OR (status = 'partially_paid' AND paid_amount + prepayment_applied_amount <= 0);

-- E09 [WARN] Overpaid invoice: received more than due and not refunded or
-- transferred (credit balance owed to the client). Ids: invoices.id.
SELECT 'E09_invoice_overpaid' AS check_id, count(*) AS n,
       (array_agg(id ORDER BY id))[1:20] AS sample_ids
FROM invoices
WHERE status <> 'cancelled'
  AND paid_amount + prepayment_applied_amount > total_gross - credited_amount + 0.005;

-- E10 [WARN] Money on a cancelled or draft invoice: net cash > 0 that was
-- neither refunded nor transferred. Ids: invoices.id.
SELECT 'E10_money_on_cancelled_or_draft_invoice' AS check_id, count(*) AS n,
       (array_agg(id ORDER BY id))[1:20] AS sample_ids
FROM invoices
WHERE status IN ('cancelled', 'draft') AND (paid_amount > 0 OR prepayment_applied_amount > 0);

-- E11 [BUG] A released invoice that was cancelled has no Storno document
-- (GoBD), or a Storno document exists for an invoice that is not cancelled.
-- Released = carries an invoice number. Ids: invoices.id.
SELECT 'E11_storno_document_mismatch' AS check_id, count(*) AS n,
       (array_agg(i.id ORDER BY i.id))[1:20] AS sample_ids
FROM invoices i
WHERE (i.status = 'cancelled' AND NULLIF(btrim(i.invoice_number), '') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM invoice_storno_documents s WHERE s.invoice_id = i.id))
   OR (i.status <> 'cancelled'
       AND EXISTS (SELECT 1 FROM invoice_storno_documents s WHERE s.invoice_id = i.id));

-- E12 [BUG] Numbering: a released invoice (sent/paid/...) without number or
-- release time, a draft with a number, or one number used twice.
-- Ids: invoices.id.
SELECT 'E12_invoice_numbering' AS check_id, count(*) AS n,
       (array_agg(id ORDER BY id))[1:20] AS sample_ids
FROM invoices i
WHERE (i.status NOT IN ('draft', 'cancelled')
       AND (NULLIF(btrim(i.invoice_number), '') IS NULL OR i.released_at IS NULL))
   OR (i.status = 'draft' AND NULLIF(btrim(i.invoice_number), '') IS NOT NULL)
   OR EXISTS (SELECT 1 FROM invoices o WHERE o.id <> i.id
              AND NULLIF(btrim(o.invoice_number), '') = NULLIF(btrim(i.invoice_number), ''));

-- E13 [BUG] Invoice of patient A on an order/quote of another patient/order.
-- Ids: invoices.id.
SELECT 'E13_invoice_order_or_quote_mismatch' AS check_id, count(*) AS n,
       (array_agg(i.id ORDER BY i.id))[1:20] AS sample_ids
FROM invoices i
LEFT JOIN orders o ON o.id = i.order_id
LEFT JOIN quotes q ON q.id = i.quote_id
WHERE (o.id IS NOT NULL AND o.patient_id <> i.patient_id)
   OR (q.id IS NOT NULL AND q.order_id IS DISTINCT FROM i.order_id);

-- E14 [BUG] Invoice allocation of an order line of another order, or with a
-- currency other than the invoice's. Ids: invoice_order_line_allocations.id.
SELECT 'E14_line_allocation_other_order' AS check_id, count(*) AS n,
       (array_agg(a.id ORDER BY a.id))[1:20] AS sample_ids
FROM invoice_order_line_allocations a
JOIN invoices i ON i.id = a.invoice_id
JOIN order_leistungen ol ON ol.id = a.order_leistung_id
WHERE ol.order_id IS DISTINCT FROM i.order_id
   OR upper(COALESCE(ol.currency, i.currency)) <> upper(i.currency);

-- E15 [WARN] Order line 'invoiced' without any allocation on a live
-- (released, not cancelled) invoice: stale after a Storno, or invoiced by a
-- path that stores no allocation. Ids: order_leistungen.id.
SELECT 'E15_line_invoiced_without_live_invoice' AS check_id, count(*) AS n,
       (array_agg(ol.id ORDER BY ol.id))[1:20] AS sample_ids
FROM order_leistungen ol
WHERE ol.status = 'invoiced'
  AND NOT EXISTS (SELECT 1 FROM invoice_order_line_allocations a JOIN invoices i ON i.id = a.invoice_id
                  WHERE a.order_leistung_id = ol.id AND i.status NOT IN ('draft', 'cancelled'))
  AND NOT EXISTS (SELECT 1 FROM invoices i
                  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(i.line_items) = 'array'
                                                               THEN i.line_items ELSE '[]'::jsonb END) li
                  WHERE i.status NOT IN ('draft', 'cancelled')
                    AND li ->> 'source_order_leistung_id' = ol.id::text);

-- E16 [BUG] Credit note / credit transfer currency differs from the invoice.
-- Ids: invoice_credit_note_transactions.id / invoice_credit_transfers.id.
SELECT 'E16_money_row_currency_mismatch' AS check_id, count(*) AS n,
       (array_agg(id ORDER BY id))[1:20] AS sample_ids
FROM (
    SELECT c.id FROM invoice_credit_note_transactions c JOIN invoices i ON i.id = c.invoice_id
    WHERE upper(c.currency) <> upper(i.currency)
    UNION ALL
    SELECT t.id FROM invoice_credit_transfers t
    JOIN invoices s ON s.id = t.source_invoice_id JOIN invoices g ON g.id = t.target_invoice_id
    WHERE upper(t.currency) <> upper(s.currency) OR upper(t.currency) <> upper(g.currency)
) x;

-- E17 [BUG] Audit gap: a payment / payment reversal / credit note / credit
-- note reversal / refund without the audit row that names its transaction id
-- (payment_recorded, payment_reversed, update_invoice_status legacy payment,
-- credit_transferred_in/out, credit_note_created/reversed, refund_recorded).
-- Ids: the transaction id.
WITH audited AS (
    SELECT DISTINCT v::uuid AS id
    FROM audit_log a
    CROSS JOIN LATERAL (VALUES
        (a.context ->> 'payment_transaction_id'),
        (a.context ->> 'reversal_transaction_id'),
        (a.context ->> 'legacy_payment_transaction_id'),
        (a.context ->> 'credit_note_transaction_id'),
        (a.context ->> 'refund_transaction_id'),
        (a.context ->> 'corrected_transaction_id'),
        (a.new_value ->> 'payment_transaction_id'),
        (a.new_value ->> 'credit_note_transaction_id'),
        (a.new_value ->> 'refund_transaction_id')) t(v)
    WHERE a.entity_type = 'invoice'
      AND v ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
)
SELECT 'E17_money_transaction_without_audit' AS check_id, count(*) AS n,
       (array_agg(id ORDER BY id))[1:20] AS sample_ids
FROM (
    SELECT id FROM invoice_payment_transactions
    UNION ALL SELECT id FROM invoice_credit_note_transactions
    UNION ALL SELECT id FROM invoice_refund_transactions
) m
WHERE NOT EXISTS (SELECT 1 FROM audited WHERE audited.id = m.id);

-- E18 [BUG] Audit gap: an invoice created through the API (create_invoice /
-- create_patient_billing_invoice / create_termination_final_invoice) that
-- carries a number (was released) but has no release audit row
-- (update_invoice_status with released = true). Ids: invoices.id.
SELECT 'E18_released_invoice_without_release_audit' AS check_id, count(*) AS n,
       (array_agg(i.id ORDER BY i.id))[1:20] AS sample_ids
FROM invoices i
WHERE NULLIF(btrim(i.invoice_number), '') IS NOT NULL
  AND EXISTS (SELECT 1 FROM audit_log a
              WHERE a.entity_type = 'invoice' AND a.entity_id = i.id
                AND a.action IN ('create_invoice', 'create_patient_billing_invoice',
                                 'create_termination_final_invoice'))
  AND NOT EXISTS (SELECT 1 FROM audit_log a
                  WHERE a.entity_type = 'invoice' AND a.entity_id = i.id
                    AND (a.context ->> 'released' = 'true' OR a.new_value ->> 'released' = 'true'));

-- E19 [INFO] Invoices with no creation audit at all: seeded or imported
-- (demo seed migration 20260417143000, test fixtures, legacy import). On PROD
-- every row here should be explainable as an import. Ids: invoices.id.
SELECT 'E19_invoice_without_creation_audit' AS check_id, count(*) AS n,
       (array_agg(i.id ORDER BY i.id))[1:20] AS sample_ids
FROM invoices i
WHERE NOT EXISTS (SELECT 1 FROM audit_log a
                  WHERE a.entity_type = 'invoice' AND a.entity_id = i.id
                    AND a.action IN ('create_invoice', 'create_patient_billing_invoice',
                                     'create_termination_final_invoice'));

-- -----------------------------------------------------------------------------
-- F. Orders, appointments, tasks
-- -----------------------------------------------------------------------------

-- F01 [BUG] Completed order with open order checklist items (completion
-- refuses any open item). Ids: orders.id.
SELECT 'F01_completed_order_open_checklist' AS check_id, count(*) AS n,
       (array_agg(o.id ORDER BY o.id))[1:20] AS sample_ids
FROM orders o
WHERE o.status = 'completed'
  AND EXISTS (SELECT 1 FROM workflow_checklist_items w
              WHERE w.scope_type = 'order' AND w.order_id = o.id AND NOT w.is_completed);

-- F02 [WARN] Completed order with unsettled lines (planned/delivered or
-- approved but not invoiced) or open invoices (draft/sent/partially_paid/
-- overdue) - completion refuses them; a later reversal can reopen money.
-- Ids: orders.id.
SELECT 'F02_completed_order_unsettled' AS check_id, count(*) AS n,
       (array_agg(o.id ORDER BY o.id))[1:20] AS sample_ids
FROM orders o
WHERE o.status = 'completed'
  AND (EXISTS (SELECT 1 FROM order_leistungen ol WHERE ol.order_id = o.id
               AND ol.status IN ('planned', 'delivered', 'approved'))
       OR EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id
                  AND i.status IN ('draft', 'sent', 'partially_paid', 'overdue')));

-- F03 [BUG] Cancelled order with an appointment still planned/confirmed on or
-- after the day of the cancellation (cancel_order cancels upcoming visits,
-- except those with approved interpreter billing). Ids: appointments.id.
SELECT 'F03_upcoming_visit_of_cancelled_order' AS check_id, count(*) AS n,
       (array_agg(a.id ORDER BY a.id))[1:20] AS sample_ids
FROM appointments a JOIN orders o ON o.id = a.order_id
WHERE o.status = 'cancelled'
  AND a.status IN ('planned', 'confirmed')
  AND a.date >= COALESCE((o.cancelled_at AT TIME ZONE 'Europe/Berlin')::date,
                         (now() AT TIME ZONE 'Europe/Berlin')::date)
  AND NOT EXISTS (SELECT 1 FROM interpreter_reports r
                  WHERE r.appointment_id = a.id AND r.approval_status = 'approved'
                    AND r.billing_reversed_at IS NULL);

-- F04 [WARN] Cancelled order with a PAST appointment still planned/confirmed
-- (by design not cancelled automatically; staff must close it). Ids:
-- appointments.id.
SELECT 'F04_past_open_visit_of_cancelled_order' AS check_id, count(*) AS n,
       (array_agg(a.id ORDER BY a.id))[1:20] AS sample_ids
FROM appointments a JOIN orders o ON o.id = a.order_id
WHERE o.status = 'cancelled'
  AND a.status IN ('planned', 'confirmed')
  AND a.date < COALESCE((o.cancelled_at AT TIME ZONE 'Europe/Berlin')::date,
                        (now() AT TIME ZONE 'Europe/Berlin')::date);

-- F05 [BUG] Cancelled order with order lines still 'planned' or open order
-- checklist items (both are closed in the cancel transaction). Ids: orders.id.
SELECT 'F05_cancelled_order_open_lines_or_items' AS check_id, count(*) AS n,
       (array_agg(o.id ORDER BY o.id))[1:20] AS sample_ids
FROM orders o
WHERE o.status = 'cancelled'
  AND (EXISTS (SELECT 1 FROM order_leistungen ol WHERE ol.order_id = o.id AND ol.status = 'planned')
       OR EXISTS (SELECT 1 FROM workflow_checklist_items w
                  WHERE w.scope_type = 'order' AND w.order_id = o.id AND NOT w.is_completed));

-- F06 [WARN] Open task (not deleted) that belongs to a cancelled order or a
-- cancelled appointment. Checklist-linked tasks are cancelled with the order;
-- free tasks are not. Ids: tasks.id.
SELECT 'F06_open_task_of_cancelled_order_or_visit' AS check_id, count(*) AS n,
       (array_agg(t.id ORDER BY t.id))[1:20] AS sample_ids
FROM tasks t
LEFT JOIN orders o ON o.id = t.order_id
LEFT JOIN appointments a ON a.id = t.appointment_id
WHERE t.deleted_at IS NULL
  AND t.status IN ('open', 'in_progress', 'on_hold', 'review')
  AND (o.status = 'cancelled' OR a.status = 'cancelled');

-- F07 [BUG] Checklist item linked to a task that is closed the other way
-- round: item open while its task is completed/cancelled, or item done while
-- its task is still open. Ids: workflow_checklist_items.id.
SELECT 'F07_checklist_item_vs_linked_task' AS check_id, count(*) AS n,
       (array_agg(w.id ORDER BY w.id))[1:20] AS sample_ids
FROM workflow_checklist_items w JOIN tasks t ON t.id = w.linked_task_id
WHERE (NOT w.is_completed AND t.status IN ('completed', 'cancelled'))
   OR (w.is_completed AND t.deleted_at IS NULL AND t.status IN ('open', 'in_progress', 'on_hold', 'review'));

-- F08 [BUG] Checklist owner is a patient/parent portal account (fix-51 D-09:
-- owners are active staff assigned to the patient, or billing). Ids:
-- workflow_checklist_items.id.
SELECT 'F08_checklist_owned_by_portal_account' AS check_id, count(*) AS n,
       (array_agg(w.id ORDER BY w.id))[1:20] AS sample_ids
FROM workflow_checklist_items w JOIN users u ON u.id = w.owner_user_id
WHERE u.role = 'patient';

-- F09 [BUG] Record of patient A pointing at an order/appointment of patient B:
-- appointments, tasks, documents, order lines with a patient. Ids: the
-- record's id.
SELECT 'F09_cross_patient_order_or_visit_link' AS check_id, count(*) AS n,
       (array_agg(id ORDER BY id))[1:20] AS sample_ids
FROM (
    SELECT a.id FROM appointments a JOIN orders o ON o.id = a.order_id WHERE o.patient_id <> a.patient_id
    UNION ALL
    SELECT t.id FROM tasks t JOIN orders o ON o.id = t.order_id
    WHERE t.patient_id IS NOT NULL AND o.patient_id <> t.patient_id
    UNION ALL
    SELECT t.id FROM tasks t JOIN appointments a ON a.id = t.appointment_id
    WHERE t.patient_id IS NOT NULL AND a.patient_id <> t.patient_id
    UNION ALL
    SELECT d.id FROM documents d JOIN orders o ON o.id = d.order_id
    WHERE d.patient_id IS NOT NULL AND o.patient_id <> d.patient_id
    UNION ALL
    SELECT d.id FROM documents d JOIN appointments a ON a.id = d.appointment_id
    WHERE d.patient_id IS NOT NULL AND a.patient_id <> d.patient_id
    UNION ALL
    SELECT ol.id FROM order_leistungen ol JOIN orders o ON o.id = ol.order_id
    WHERE ol.patient_id IS NOT NULL AND o.patient_id <> ol.patient_id
) x;

-- F10 [BUG] Order status/phase contradiction: cancelled without cancelled_at,
-- or cancelled_at on an order that is not cancelled. Ids: orders.id.
SELECT 'F10_order_cancel_fields' AS check_id, count(*) AS n,
       (array_agg(id ORDER BY id))[1:20] AS sample_ids
FROM orders
WHERE (status = 'cancelled' AND cancelled_at IS NULL)
   OR (status <> 'cancelled' AND cancelled_at IS NOT NULL);

-- -----------------------------------------------------------------------------
-- G. Documents, shares, translations
-- -----------------------------------------------------------------------------

-- G01 [BUG] A medical document has an active share to a staff account of a
-- role that must not see medical documents (sales, billing, concierge,
-- IT admin). Ids: document_shares.id.
SELECT 'G01_medical_doc_shared_to_forbidden_role' AS check_id, count(*) AS n,
       (array_agg(s.id ORDER BY s.id))[1:20] AS sample_ids
FROM document_shares s
JOIN documents d ON d.id = s.document_id
JOIN users u ON u.id = s.shared_with_user_id
WHERE s.revoked_at IS NULL
  AND (d.is_medical OR d.access_category = 'medical')
  AND u.role IN ('sales', 'billing', 'concierge', 'it_admin');

-- G02 [BUG] Active portal share of a patient's document to a login that never
-- had any assignment to that patient (wrong person's portal). Revoked
-- assignments (coming of age) keep shares as history and are not flagged.
-- Ids: document_shares.id.
SELECT 'G02_portal_share_to_unrelated_login' AS check_id, count(*) AS n,
       (array_agg(s.id ORDER BY s.id))[1:20] AS sample_ids
FROM document_shares s
JOIN documents d ON d.id = s.document_id
WHERE s.revoked_at IS NULL
  AND s.channel = 'patient_portal'
  AND d.patient_id IS NOT NULL
  AND s.shared_with_user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM patient_assignments pa
                  WHERE pa.patient_id = d.patient_id AND pa.user_id = s.shared_with_user_id);

-- G03 [WARN] Active portal share of a document that is internal again
-- (visibility 'internal'): withdrawing from the portal should revoke the
-- share. Ids: document_shares.id.
SELECT 'G03_portal_share_of_internal_document' AS check_id, count(*) AS n,
       (array_agg(s.id ORDER BY s.id))[1:20] AS sample_ids
FROM document_shares s JOIN documents d ON d.id = s.document_id
WHERE s.revoked_at IS NULL AND s.channel = 'patient_portal' AND d.visibility = 'internal';

-- G04 [BUG] Medical flag and access category disagree. Ids: documents.id.
SELECT 'G04_medical_flag_vs_category' AS check_id, count(*) AS n,
       (array_agg(id ORDER BY id))[1:20] AS sample_ids
FROM documents
WHERE (is_medical AND access_category IS NOT NULL AND access_category <> 'medical')
   OR (NOT is_medical AND access_category = 'medical');

-- G05 [BUG] A translation of a medical source is not medical (or belongs to
-- another patient): the medical boundary would not protect it. Ids:
-- documents.id of the translated document.
SELECT 'G05_translation_lost_medical_flag_or_patient' AS check_id, count(*) AS n,
       (array_agg(DISTINCT t.id))[1:20] AS sample_ids
FROM (
    SELECT translated_document_id AS tid, document_id AS sid FROM document_translations
    WHERE translated_document_id IS NOT NULL
    UNION
    SELECT translated_document_id, document_id FROM document_translation_requests
    WHERE translated_document_id IS NOT NULL
) x
JOIN documents t ON t.id = x.tid
JOIN documents s ON s.id = x.sid
WHERE (s.is_medical AND NOT t.is_medical)
   OR t.patient_id IS DISTINCT FROM s.patient_id;

-- G06 [BUG] A translation document (document_variant 'translation') that no
-- translation row or request links to its source. Ids: documents.id.
SELECT 'G06_translation_without_source' AS check_id, count(*) AS n,
       (array_agg(d.id ORDER BY d.id))[1:20] AS sample_ids
FROM documents d
WHERE d.document_variant = 'translation'
  AND NOT EXISTS (SELECT 1 FROM document_translations t WHERE t.translated_document_id = d.id)
  AND NOT EXISTS (SELECT 1 FROM document_translation_requests r WHERE r.translated_document_id = d.id);

-- G07 [WARN] Completed translation request with neither a translated document
-- nor a translated text. Ids: document_translation_requests.id.
SELECT 'G07_completed_translation_without_result' AS check_id, count(*) AS n,
       (array_agg(id ORDER BY id))[1:20] AS sample_ids
FROM document_translation_requests
WHERE status = 'completed'
  AND translated_document_id IS NULL
  AND NULLIF(btrim(translated_text), '') IS NULL;

-- G08 [BUG] Translation request of patient A for a document of patient B.
-- Ids: document_translation_requests.id.
SELECT 'G08_translation_request_other_patient' AS check_id, count(*) AS n,
       (array_agg(r.id ORDER BY r.id))[1:20] AS sample_ids
FROM document_translation_requests r JOIN documents d ON d.id = r.document_id
WHERE d.patient_id IS DISTINCT FROM r.patient_id;

-- G09 [WARN] Medical translation request assigned to a role that may not hold
-- medical work (fix-25 A-03: never a concierge; also sales/billing/IT admin).
-- Ids: document_translation_requests.id.
SELECT 'G09_medical_translation_assigned_to_forbidden_role' AS check_id, count(*) AS n,
       (array_agg(r.id ORDER BY r.id))[1:20] AS sample_ids
FROM document_translation_requests r
JOIN documents d ON d.id = r.document_id
JOIN users u ON u.id = r.assigned_to
WHERE d.is_medical AND r.status IN ('pending', 'in_progress')
  AND u.role IN ('concierge', 'sales', 'billing', 'it_admin', 'patient');

-- G10 [BUG] Several current versions: two documents replace the same
-- document. Ids: documents.id of the replaced document.
SELECT 'G10_document_replaced_twice' AS check_id, count(*) AS n,
       (array_agg(replaces_document_id ORDER BY replaces_document_id))[1:20] AS sample_ids
FROM (
    SELECT replaces_document_id FROM documents
    WHERE replaces_document_id IS NOT NULL
    GROUP BY replaces_document_id HAVING count(*) > 1
) x;

-- G11 [BUG] Direct staff access rule that lets a role without medical
-- access read/use medical documents: an 'all documents' allow other than
-- upload (fix-49 F-x2), or a record allow on a medical document. Active,
-- non-revoked allow rules only (profile rules are not covered here).
-- Ids: staff_user_access_rules.id.
SELECT 'G11_access_rule_crosses_medical_boundary' AS check_id, count(*) AS n,
       (array_agg(r.id ORDER BY r.id))[1:20] AS sample_ids
FROM staff_user_access_rules r
JOIN users u ON u.id = r.user_id
LEFT JOIN documents d ON r.scope_type = 'record' AND d.id = r.resource_id
WHERE r.revoked_at IS NULL AND r.effect = 'allow'
  AND (r.valid_until IS NULL OR r.valid_until > now())
  AND r.resource_type = 'document'
  AND u.role IN ('concierge', 'sales', 'billing', 'it_admin')
  AND ((r.scope_type = 'all' AND r.capability <> 'upload')
       OR (r.scope_type = 'record' AND d.is_medical));

-- =============================================================================
-- End. Expected: n = 0 for every [BUG] check.
-- =============================================================================
