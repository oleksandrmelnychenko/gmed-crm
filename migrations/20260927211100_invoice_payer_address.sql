-- Postal address of an invoice payer. An invoice names its recipient with full
-- name and address (§ 14 Abs. 4 Nr. 1 UStG); a payer who is a patient record
-- brings that record's address, a free-text payer needs its own.
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS payer_address_street TEXT,
    ADD COLUMN IF NOT EXISTS payer_address_zip TEXT,
    ADD COLUMN IF NOT EXISTS payer_address_city TEXT,
    ADD COLUMN IF NOT EXISTS payer_address_country TEXT;
