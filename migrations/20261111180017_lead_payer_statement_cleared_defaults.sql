-- The payer link offers some answers as editable defaults taken from what the
-- lead entered about the payer (name, address, phone, an organisation's legal
-- form, ...). Those defaults are not stored in the statement: an answer the
-- payer has not given shows the default. An answer the payer emptied was
-- stored as NULL too, so the default came back a second later and the
-- deletion was silently undone (recheck 2026-11-11, N2).
--
-- The keys the payer (or staff copying the paper form) emptied are kept here;
-- their default is not offered again. No backfill: existing rows start empty,
-- which is today's behaviour. The reset of the statement on a payer change
-- empties the list with the answers.
ALTER TABLE lead_payer_statements
    ADD COLUMN cleared_defaults TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN lead_payer_statements.cleared_defaults IS
    'Answer keys the writer emptied: their default from the payer declaration is not offered again.';
