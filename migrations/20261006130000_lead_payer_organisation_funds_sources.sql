-- Lead cabinet, the payer's own link (QA 2026-10-06, C7-b): a company, an
-- organisation or an insurer states its source of funds from a list of its
-- own (business revenue, equity, loan, insurance benefit, donation, other);
-- a person keeps the declaration's list. The server takes only the list of
-- the payer type (`routes/lead_payer_link.rs`); the column accepts both. On
-- adoption into the declaration an organisation's source maps to the
-- declaration's list (`lead_payer_declarations.source_of_funds` unchanged).
-- See docs/architecture/lead-payer-declaration_ua.md.
--
-- The check was added inline with the column (migration 20261006110000), so
-- PostgreSQL named it `lead_payer_statements_funds_sources_check`; a copy
-- whose check carries another name is covered by dropping every
-- single-column check on the column.
DO $$
DECLARE
    sources_check RECORD;
BEGIN
    FOR sources_check IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'c'
          AND c.conrelid = 'lead_payer_statements'::regclass
          AND a.attname = 'funds_sources'
          AND array_length(c.conkey, 1) = 1
    LOOP
        EXECUTE format('ALTER TABLE lead_payer_statements DROP CONSTRAINT IF EXISTS %I',
                       sources_check.conname);
    END LOOP;
END $$;

ALTER TABLE lead_payer_statements
    ADD CONSTRAINT lead_payer_statements_funds_sources_check CHECK (
        funds_sources <@ ARRAY[
            'employment',
            'business_income',
            'savings',
            'asset_sale',
            'inheritance_gift',
            'business_revenue',
            'equity',
            'loan',
            'insurance_benefit',
            'donation',
            'other'
        ]::text[]
    );
