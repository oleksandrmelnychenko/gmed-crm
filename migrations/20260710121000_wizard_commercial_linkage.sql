-- Attribute every order service to the patient who received it. This is
-- essential for a MAIN family order whose payer and service recipients differ.
ALTER TABLE order_leistungen
    ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES patients(id);

UPDATE order_leistungen service
SET patient_id = orders.patient_id
FROM orders
WHERE orders.id = service.order_id
  AND service.patient_id IS NULL;

ALTER TABLE order_leistungen
    ALTER COLUMN patient_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_order_leistungen_patient
    ON order_leistungen (patient_id);

-- Retry-safe contract creation for the lead wizard.
ALTER TABLE framework_contracts
    ADD COLUMN IF NOT EXISTS client_reference TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_framework_contracts_client_reference
    ON framework_contracts (patient_id, client_reference);
