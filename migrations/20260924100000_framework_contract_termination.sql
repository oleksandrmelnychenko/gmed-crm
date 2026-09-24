-- A framework contract (Rahmendienstleistungsvertrag) is concluded for an
-- unlimited term (§ 6 of the client template) and ends only by termination.
-- Validity dates are no longer used as a gate; termination is recorded here.
ALTER TABLE framework_contracts
    ADD COLUMN terminated_at TIMESTAMPTZ,
    ADD COLUMN terminated_by UUID REFERENCES users(id),
    ADD COLUMN termination_reason TEXT;

-- Termination details belong only to terminated contracts. Rows terminated
-- before this migration keep a NULL terminated_at.
ALTER TABLE framework_contracts
    ADD CONSTRAINT framework_contracts_termination_consistent
    CHECK (terminated_at IS NULL OR status = 'terminated');
