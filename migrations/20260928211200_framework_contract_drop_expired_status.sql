-- A framework contract has no dates (owner decision): it runs from signature
-- until it is terminated. The status `expired` was never set by the
-- application any more and cannot be chosen (status audit Q8, owner decision
-- 2026-09-28). A contract that was marked expired had ended, so it becomes
-- `terminated`: it no longer covers new orders and a new contract is created,
-- as after a termination. Nothing is cancelled or settled here; the reason
-- records the migration. Every changed contract is audited in this
-- transaction with its previous status; the audit row has no acting user.
WITH expired AS (
    SELECT id, patient_id, lead_id, contract_number
    FROM framework_contracts
    WHERE status = 'expired'
    FOR UPDATE
),
migrated AS (
    UPDATE framework_contracts contract
    SET status = 'terminated',
        terminated_at = COALESCE(contract.terminated_at, contract.updated_at),
        termination_reason = COALESCE(
            contract.termination_reason,
            'Status "expired" retired: framework contracts have no end date (migration 20260928211200)'
        )
    FROM expired
    WHERE contract.id = expired.id
    RETURNING contract.id, expired.patient_id, expired.lead_id, expired.contract_number
)
INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_value, new_value, context)
SELECT NULL,
       'migrate_expired_framework_contract',
       'framework_contract',
       migrated.id,
       jsonb_build_object('status', 'expired'),
       jsonb_build_object('status', 'terminated'),
       jsonb_build_object(
           'contract_number', migrated.contract_number,
           'patient_id', migrated.patient_id,
           'lead_id', migrated.lead_id,
           'reason', 'framework_contract_has_no_end_date',
           'repair', '20260928211200_framework_contract_drop_expired_status'
       )
FROM migrated;

-- The patient card mirrors the effective contract status; with `expired`
-- gone the next status in line is `terminated`.
WITH affected AS (
    SELECT id
    FROM patients
    WHERE legal_status->>'contract_status' = 'expired'
    FOR UPDATE
),
updated AS (
    UPDATE patients patient
    SET legal_status = jsonb_set(patient.legal_status, '{contract_status}', to_jsonb('terminated'::text), true)
    FROM affected
    WHERE patient.id = affected.id
    RETURNING patient.id
)
INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_value, new_value, context)
SELECT NULL,
       'migrate_expired_patient_contract_status',
       'patient',
       updated.id,
       jsonb_build_object('contract_status', 'expired'),
       jsonb_build_object('contract_status', 'terminated'),
       jsonb_build_object('repair', '20260928211200_framework_contract_drop_expired_status')
FROM updated;

ALTER TABLE framework_contracts DROP CONSTRAINT IF EXISTS framework_contracts_status_check;
ALTER TABLE framework_contracts
    ADD CONSTRAINT framework_contracts_status_check
    CHECK (status IN ('draft', 'sent', 'signed', 'terminated'));
