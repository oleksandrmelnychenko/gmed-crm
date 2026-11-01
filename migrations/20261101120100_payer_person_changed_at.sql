-- The papers counted for a payer can date from before the person named now
-- (owner decision 2026-11-01): the gate stays, staff get a hint. `identity_changed_at`
-- also moves with an address, so the change of the person has its own marker.
-- NULL until another person is named: earlier changes cannot be told from an
-- address change and raise no hint.
ALTER TABLE lead_payer_declarations
    ADD COLUMN IF NOT EXISTS payer_person_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN lead_payer_declarations.payer_person_changed_at IS
    'Last time another person was named as payer; not moved by a new address of the same person.';
