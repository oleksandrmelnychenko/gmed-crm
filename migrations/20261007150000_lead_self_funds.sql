-- Lead cabinet, the self-payer's source of funds (owner request 2026-10-05
-- "We must have a proof of income — maybe an uploader for it"; owner rule
-- 2026-10-07 on the enhanced check).
--
-- A patient who pays himself states in the cabinet where the money comes
-- from: the sources of the person list (the same list as the declaration's
-- `source_of_funds` and the payer page of a person), a description (required
-- with "other") and a proof (bank statement, salary slip …). The proof is
-- required only while the enhanced check of the lead is required
-- (`routes/lead_enhanced_check.rs`); otherwise it is optional.
--
-- The answers live on the payer declaration next to the cabinet's other
-- answers (sections 7 and 8): only the cabinet writes them, every other save
-- keeps them, staff read them in "Кто платит" and "Данные от пациента". They
-- belong to a self-payer: a declaration that names a third party holds none
-- (the server clears them when who pays changes). The proof is a portal
-- upload of its own kind; it is the patient's own document, never an identity
-- document, and goes with the lead's documents on the purge. No backfill.
-- See docs/architecture/lead-patient-portal_ua.md and
-- lead-payer-declaration_ua.md.

ALTER TABLE lead_payer_declarations
    ADD COLUMN IF NOT EXISTS self_funds_sources TEXT[] NOT NULL DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS self_funds_description TEXT;

ALTER TABLE lead_payer_declarations
    DROP CONSTRAINT IF EXISTS lead_payer_declarations_self_funds_sources_check,
    DROP CONSTRAINT IF EXISTS lead_payer_declarations_self_funds_description_check,
    DROP CONSTRAINT IF EXISTS lead_payer_declarations_self_funds_payer_check;

ALTER TABLE lead_payer_declarations
    ADD CONSTRAINT lead_payer_declarations_self_funds_sources_check CHECK (
        self_funds_sources <@ ARRAY[
            'employment',
            'business_income',
            'savings',
            'asset_sale',
            'inheritance_gift',
            'other'
        ]::text[]
    ),
    ADD CONSTRAINT lead_payer_declarations_self_funds_description_check CHECK (
        self_funds_description IS NULL OR char_length(self_funds_description) <= 2000
    ),
    ADD CONSTRAINT lead_payer_declarations_self_funds_payer_check CHECK (
        payer_kind = 'self'
        OR (self_funds_sources = '{}'::text[] AND self_funds_description IS NULL)
    );

-- The proof of the self-payer's funds is a portal upload of its own kind.
-- The kind check is named by migration 20261006110000; a copy whose check
-- carries another name is covered by dropping every single-column check on
-- the column.
DO $$
DECLARE
    upload_check RECORD;
BEGIN
    FOR upload_check IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'c'
          AND c.conrelid = 'lead_portal_uploads'::regclass
          AND a.attname = 'kind'
          AND array_length(c.conkey, 1) = 1
    LOOP
        EXECUTE format('ALTER TABLE lead_portal_uploads DROP CONSTRAINT IF EXISTS %I',
                       upload_check.conname);
    END LOOP;
END $$;

ALTER TABLE lead_portal_uploads
    DROP CONSTRAINT IF EXISTS lead_portal_uploads_kind_check;
ALTER TABLE lead_portal_uploads
    ADD CONSTRAINT lead_portal_uploads_kind_check CHECK (
        kind IN (
            'medical',
            'identity',
            'representative_identity',
            'representative_authority',
            'payer_identity',
            'payer_funds_proof',
            'self_funds_proof'
        )
    );
