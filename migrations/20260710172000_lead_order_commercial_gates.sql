-- Capture the two order signatures independently and make prepayment an
-- explicit onboarding gate instead of inferring it from a non-zero payment.
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS signed_patient_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS signed_agency_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS prepayment_required BOOLEAN NOT NULL DEFAULT false;

UPDATE orders
SET signed_patient_at = COALESCE(signed_patient_at, signed_at, updated_at)
WHERE signed_patient
  AND signed_patient_at IS NULL;

UPDATE orders
SET signed_agency_at = COALESCE(signed_agency_at, signed_at, updated_at)
WHERE signed_agency
  AND signed_agency_at IS NULL;
