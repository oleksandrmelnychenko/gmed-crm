-- Lead cabinet, invoice recipient and payment route (owner spec
-- "Patientenformular (Lead-Link)", sections 7 and 8, phase 2, 2026-10-06).
-- Both sections live on the payer declaration: section 7 is the input of the
-- invoice recipient chain and refers to the declared payer; section 8 is the
-- payer's own answer, and that row is the payer (self or third party). See
-- docs/architecture/lead-payer-declaration_ua.md.

ALTER TABLE lead_payer_declarations
    -- Section 7: where the invoice goes. `self` = the patient (for a minor the
    -- parents as contracting party), `payer` = the declared third party (only
    -- with one), `other` = the party at another address (role
    -- `invoice_address` on the invoice; no Kostenübernehmer).
    ADD COLUMN IF NOT EXISTS invoice_to TEXT,
    -- The other address (`invoice_to = 'other'` only).
    ADD COLUMN IF NOT EXISTS invoice_name TEXT,
    ADD COLUMN IF NOT EXISTS invoice_street TEXT,
    ADD COLUMN IF NOT EXISTS invoice_zip TEXT,
    ADD COLUMN IF NOT EXISTS invoice_city TEXT,
    ADD COLUMN IF NOT EXISTS invoice_country TEXT,
    -- E-mail for invoices (`self` or `other`); shown, not yet used by the
    -- e-invoice.
    ADD COLUMN IF NOT EXISTS invoice_email TEXT,
    -- Staff fields of the invoice recipient (USt-IdNr., Steuernummer); the
    -- cabinet never touches them.
    ADD COLUMN IF NOT EXISTS invoice_vat_id TEXT,
    ADD COLUMN IF NOT EXISTS invoice_tax_number TEXT,
    -- Section 8: how the payer will pay. Cash, crypto, "other" and a payment
    -- through a third person or a payment service provider are compliance
    -- flags for staff (GwG), nothing is blocked.
    ADD COLUMN IF NOT EXISTS payment_method TEXT,
    ADD COLUMN IF NOT EXISTS payment_method_details TEXT,
    ADD COLUMN IF NOT EXISTS account_country TEXT,
    ADD COLUMN IF NOT EXISTS account_holder TEXT,
    ADD COLUMN IF NOT EXISTS bank_name TEXT,
    ADD COLUMN IF NOT EXISTS via_third_party BOOLEAN,
    ADD COLUMN IF NOT EXISTS via_third_party_details TEXT;

ALTER TABLE lead_payer_declarations
    DROP CONSTRAINT IF EXISTS lead_payer_declarations_invoice_to_check,
    DROP CONSTRAINT IF EXISTS lead_payer_declarations_invoice_address_check,
    DROP CONSTRAINT IF EXISTS lead_payer_declarations_invoice_email_check,
    DROP CONSTRAINT IF EXISTS lead_payer_declarations_invoice_tax_check,
    DROP CONSTRAINT IF EXISTS lead_payer_declarations_payment_method_check,
    DROP CONSTRAINT IF EXISTS lead_payer_declarations_payment_account_check,
    DROP CONSTRAINT IF EXISTS lead_payer_declarations_via_third_party_check;

-- Lengths and enums only; which dependent field goes with which answer is
-- enforced by the server (`routes/lead_payer.rs`).
ALTER TABLE lead_payer_declarations
    ADD CONSTRAINT lead_payer_declarations_invoice_to_check CHECK (
        invoice_to IS NULL
        OR (invoice_to IN ('self', 'payer', 'other')
            AND (invoice_to <> 'payer' OR payer_kind = 'third_party'))
    ),
    ADD CONSTRAINT lead_payer_declarations_invoice_address_check CHECK (
        (invoice_name IS NULL OR char_length(invoice_name) <= 200)
        AND (invoice_street IS NULL OR char_length(invoice_street) <= 200)
        AND (invoice_zip IS NULL OR char_length(invoice_zip) <= 20)
        AND (invoice_city IS NULL OR char_length(invoice_city) <= 200)
        AND (invoice_country IS NULL OR invoice_country ~ '^[A-Z]{2}$')
    ),
    ADD CONSTRAINT lead_payer_declarations_invoice_email_check CHECK (
        invoice_email IS NULL OR char_length(invoice_email) <= 254
    ),
    ADD CONSTRAINT lead_payer_declarations_invoice_tax_check CHECK (
        (invoice_vat_id IS NULL OR char_length(invoice_vat_id) <= 20)
        AND (invoice_tax_number IS NULL OR char_length(invoice_tax_number) <= 30)
    ),
    ADD CONSTRAINT lead_payer_declarations_payment_method_check CHECK (
        (payment_method IS NULL
            OR payment_method IN ('bank_transfer', 'card', 'cash', 'crypto', 'other'))
        AND (payment_method_details IS NULL OR char_length(payment_method_details) <= 200)
    ),
    ADD CONSTRAINT lead_payer_declarations_payment_account_check CHECK (
        (account_country IS NULL OR account_country ~ '^[A-Z]{2}$')
        AND (account_holder IS NULL OR char_length(account_holder) <= 200)
        AND (bank_name IS NULL OR char_length(bank_name) <= 200)
    ),
    ADD CONSTRAINT lead_payer_declarations_via_third_party_check CHECK (
        via_third_party_details IS NULL OR char_length(via_third_party_details) <= 2000
    );

-- Payer role `invoice_address` on orders and invoices: the contracting party
-- at another address. Not a Kostenübernehmer (no Schuldbeitritt, no
-- Kostenübernahmeerklärung, no release confirmation). The role checks were
-- added inline with the column (migration 20261002090000), so PostgreSQL named
-- them `<table>_payer_role_check`; a rehearsal on a copy whose check carries
-- another name is covered by dropping every single-column check on the column.
DO $$
DECLARE
    role_check RECORD;
BEGIN
    FOR role_check IN
        SELECT c.conname, c.conrelid::regclass AS relation
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'c'
          AND c.conrelid IN ('orders'::regclass, 'invoices'::regclass)
          AND a.attname = 'payer_role'
          AND array_length(c.conkey, 1) = 1
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I',
                       role_check.relation, role_check.conname);
    END LOOP;
END $$;

ALTER TABLE orders
    ADD CONSTRAINT orders_payer_role_check CHECK (
        payer_role IN ('contracting_party', 'cost_bearer', 'invoice_address')
    );

ALTER TABLE invoices
    ADD CONSTRAINT invoices_payer_role_check CHECK (
        payer_role IN ('contracting_party', 'cost_bearer', 'invoice_address')
    );

-- Sanctions screening: trg_sanctions_enqueue_lead_of_payer (migration
-- 20261004110000) lists no columns, so a billing update queues the lead as
-- well; the screening is idempotent, nothing to recreate here.
