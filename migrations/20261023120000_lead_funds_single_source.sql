-- One source of the source of funds per person (owner decision 2026-10-23).
--
-- The patient's own funds (the patient pays) are the lead's answer of the
-- cabinet (`self_funds_source`, `self_funds_description`); staff complete or
-- correct the same record in the AML form of the lead wizard, and
-- `self_funds_entered_by` says who wrote it last: the lead in the cabinet or
-- staff. The payer's funds (a third party, a paying parent) are the payer's
-- own statement (`lead_payer_statements`); what the patient said of the
-- payer's funds stays the patient's statement.
--
-- Earlier staff values — the staff choice `source_of_funds` (+ words) of a
-- self-payer and the AML form's free text
-- `leads.wizard_state.aml_enhanced_due_diligence.assetOrigin` — are copied
-- into the patient's record only where the lead stated nothing, marked as
-- entered by staff. The originals stay untouched (history, § 8 GwG).
-- See docs/architecture/lead-payer-declaration_ua.md.

ALTER TABLE lead_payer_declarations
    ADD COLUMN IF NOT EXISTS self_funds_entered_by TEXT;

ALTER TABLE lead_payer_declarations
    DROP CONSTRAINT IF EXISTS lead_payer_declarations_self_funds_entered_by_check;
ALTER TABLE lead_payer_declarations
    ADD CONSTRAINT lead_payer_declarations_self_funds_entered_by_check CHECK (
        self_funds_entered_by IS NULL OR self_funds_entered_by IN ('lead', 'staff')
    );

-- Every answer stored so far came from the cabinet.
UPDATE lead_payer_declarations
SET self_funds_entered_by = 'lead'
WHERE self_funds_entered_by IS NULL
  AND (self_funds_source IS NOT NULL OR NULLIF(btrim(self_funds_description), '') IS NOT NULL);

-- 1. The staff choice of a self-payer. Employment and business income are
--    income; their label stays in front of the words so nothing is lost.
WITH copied AS (
    UPDATE lead_payer_declarations d
    SET self_funds_source = CASE d.source_of_funds
            WHEN 'employment' THEN 'income'
            WHEN 'business_income' THEN 'income'
            WHEN 'savings' THEN 'savings'
            WHEN 'asset_sale' THEN 'asset_sale'
            WHEN 'inheritance_gift' THEN 'inheritance_gift'
            ELSE 'other'
        END,
        self_funds_description = left(NULLIF(concat_ws(
            ' – ',
            CASE d.source_of_funds
                WHEN 'employment' THEN 'Gehalt / nichtselbständige Arbeit'
                WHEN 'business_income' THEN 'Einkünfte aus Unternehmen / selbständiger Tätigkeit'
            END,
            NULLIF(btrim(d.source_of_funds_description), '')
        ), ''), 2000),
        self_funds_entered_by = 'staff'
    WHERE d.payer_kind = 'self'
      AND d.source_of_funds IS NOT NULL
      AND d.self_funds_source IS NULL
      AND NULLIF(btrim(d.self_funds_description), '') IS NULL
    RETURNING d.lead_id
)
INSERT INTO audit_log (action, entity_type, entity_id, context)
SELECT 'lead_self_funds_from_staff_source', 'lead', lead_id,
       jsonb_build_object(
           'changed_fields', jsonb_build_array('self_funds_source', 'self_funds_description'),
           'entered_by', 'staff',
           'from', 'lead_payer_declarations.source_of_funds',
           'repair', '20261023120000_lead_funds_single_source')
FROM copied;

-- 2. The AML form's free text of a self-payer who still has no answer.
WITH copied AS (
    UPDATE lead_payer_declarations d
    SET self_funds_source = 'other',
        self_funds_description = left(
            btrim(l.wizard_state -> 'aml_enhanced_due_diligence' ->> 'assetOrigin'), 2000),
        self_funds_entered_by = 'staff'
    FROM leads l
    WHERE l.id = d.lead_id
      AND d.payer_kind = 'self'
      AND d.self_funds_source IS NULL
      AND NULLIF(btrim(d.self_funds_description), '') IS NULL
      AND jsonb_typeof(l.wizard_state -> 'aml_enhanced_due_diligence') = 'object'
      AND NULLIF(btrim(l.wizard_state -> 'aml_enhanced_due_diligence' ->> 'assetOrigin'), '')
          IS NOT NULL
    RETURNING d.lead_id
)
INSERT INTO audit_log (action, entity_type, entity_id, context)
SELECT 'lead_self_funds_from_staff_source', 'lead', lead_id,
       jsonb_build_object(
           'changed_fields', jsonb_build_array('self_funds_source', 'self_funds_description'),
           'entered_by', 'staff',
           'from', 'leads.wizard_state.aml_enhanced_due_diligence.assetOrigin',
           'repair', '20261023120000_lead_funds_single_source')
FROM copied;
