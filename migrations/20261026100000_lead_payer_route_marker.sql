-- The payment route the payer gives on its own link counts only once the
-- payer has sent the statement (owner decision 2026-10-26, extending
-- «Рахувати лише відправлене» of 2026-10-25). Section 8 is still kept on
-- `lead_payer_declarations` as the payer types it — staff and the payer's
-- form read it there — but its triggers (T8 via a third party, T9 cash) wait
-- while the statement is unsent and the declaration's route is still the one
-- the link wrote.
--
-- `payment_route_marker` is a digest of section 8 as the link last stored it
-- (never a value). A route staff change afterwards no longer matches it and
-- counts at once. Cleared with the statement when another payer answers.
--
-- Additive and safe on existing data: existing rows stay NULL, so a route a
-- payer gave before this migration keeps counting as it did.
ALTER TABLE lead_payer_statements
    ADD COLUMN IF NOT EXISTS payment_route_marker TEXT
        CHECK (payment_route_marker IS NULL OR char_length(payment_route_marker) <= 64);

COMMENT ON COLUMN lead_payer_statements.payment_route_marker IS
    'Digest of section 8 (payment route) as the payer link last wrote it to lead_payer_declarations; while the statement is unsent and the route still matches, T8/T9 are pending (owner decision 2026-10-26).';
