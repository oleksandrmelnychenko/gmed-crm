-- Lead cabinet, the two-stage form (owner requests 2026-10-07).
--
-- 1. The extra step "Zusätzliche Angaben": shown while the enhanced check of
--    the lead is required by its triggers (routes/lead_enhanced_check.rs) or
--    a third party outside the first circle (spouse, parent, child) pays.
--    - The self-payer's source of funds is ONE choice (Einkommen, Ersparnisse,
--      Verkauf von Vermögenswerten, Erbschaft, Sonstiges) with a free text:
--      `self_funds_source` replaces the list `self_funds_sources` of
--      migration 20261007150000. A stored list becomes one value: a single
--      source is kept (employment and business income are income), several
--      are "other" and their labels go in front of the description.
--    - What the patient knows of a third party's funds ("soweit bekannt"):
--      `payer_funds_source_stated`, `payer_funds_description_stated`. The
--      patient's statement, never the payer's declaration; it belongs to the
--      payer named and goes with another payer.
--    - Profession and sector of the contract partner (the adult lead, or the
--      parent who fills in for a minor): `lead_gwg_declarations.occupation`
--      and `.sector`.
-- 2. The payer's basic data: a messenger / WhatsApp number of a third-party
--    payer (`messenger`); the cabinet now requires e-mail, phone and the
--    residence (country, city) of a third party.
-- 3. Two more relationships of a payer: `sibling` and `grandparent` (both
--    outside the first circle); `relative` stays for any other relative.
--
-- See docs/architecture/lead-patient-portal_ua.md,
-- aml-enhanced-due-diligence_ua.md and lead-payer-declaration_ua.md.

-- 1a. One source of the self-payer's funds.
ALTER TABLE lead_payer_declarations
    ADD COLUMN IF NOT EXISTS self_funds_source TEXT;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'lead_payer_declarations' AND column_name = 'self_funds_sources'
    ) THEN
        -- Several sources: "other", with the labels in front of the words.
        EXECUTE $sql$
            UPDATE lead_payer_declarations
            SET self_funds_source = CASE
                    WHEN cardinality(self_funds_sources) = 0 THEN NULL
                    WHEN cardinality(self_funds_sources) > 1 THEN 'other'
                    WHEN self_funds_sources[1] IN ('employment', 'business_income') THEN 'income'
                    ELSE self_funds_sources[1]
                END,
                self_funds_description = CASE
                    WHEN cardinality(self_funds_sources) > 1 THEN left(
                        concat_ws(
                            ' – ',
                            'Angaben: ' || array_to_string(ARRAY(
                                SELECT CASE source
                                    WHEN 'employment' THEN 'Einkommen aus Beschäftigung'
                                    WHEN 'business_income' THEN 'Einkünfte aus selbständiger Tätigkeit'
                                    WHEN 'savings' THEN 'Ersparnisse'
                                    WHEN 'asset_sale' THEN 'Verkauf von Vermögenswerten'
                                    WHEN 'inheritance_gift' THEN 'Erbschaft'
                                    ELSE 'Sonstiges'
                                END
                                FROM unnest(self_funds_sources) AS source
                            ), ', '),
                            self_funds_description
                        ),
                        2000
                    )
                    ELSE self_funds_description
                END
            WHERE self_funds_source IS NULL
        $sql$;
    END IF;
END $$;

ALTER TABLE lead_payer_declarations
    DROP CONSTRAINT IF EXISTS lead_payer_declarations_self_funds_sources_check,
    DROP CONSTRAINT IF EXISTS lead_payer_declarations_self_funds_payer_check,
    DROP CONSTRAINT IF EXISTS lead_payer_declarations_self_funds_source_check;

ALTER TABLE lead_payer_declarations
    DROP COLUMN IF EXISTS self_funds_sources;

ALTER TABLE lead_payer_declarations
    ADD CONSTRAINT lead_payer_declarations_self_funds_source_check CHECK (
        self_funds_source IS NULL
        OR self_funds_source IN ('income', 'savings', 'asset_sale', 'inheritance_gift', 'other')
    ),
    ADD CONSTRAINT lead_payer_declarations_self_funds_payer_check CHECK (
        payer_kind = 'self'
        OR (self_funds_source IS NULL AND self_funds_description IS NULL)
    );

-- 1b. What the patient knows of the third party's funds.
ALTER TABLE lead_payer_declarations
    ADD COLUMN IF NOT EXISTS payer_funds_source_stated TEXT,
    ADD COLUMN IF NOT EXISTS payer_funds_description_stated TEXT;

ALTER TABLE lead_payer_declarations
    DROP CONSTRAINT IF EXISTS lead_payer_declarations_payer_funds_stated_check;
ALTER TABLE lead_payer_declarations
    ADD CONSTRAINT lead_payer_declarations_payer_funds_stated_check CHECK (
        (payer_funds_source_stated IS NULL
            OR payer_funds_source_stated IN (
                'income', 'savings', 'asset_sale', 'inheritance_gift', 'other'))
        AND (payer_funds_description_stated IS NULL
            OR char_length(payer_funds_description_stated) <= 2000)
        AND (payer_kind = 'third_party'
            OR (payer_funds_source_stated IS NULL AND payer_funds_description_stated IS NULL))
    );

-- 1c. Profession and sector of the contract partner.
ALTER TABLE lead_gwg_declarations
    ADD COLUMN IF NOT EXISTS occupation TEXT,
    ADD COLUMN IF NOT EXISTS sector TEXT;

ALTER TABLE lead_gwg_declarations
    DROP CONSTRAINT IF EXISTS lead_gwg_declarations_occupation_check,
    DROP CONSTRAINT IF EXISTS lead_gwg_declarations_sector_check;
ALTER TABLE lead_gwg_declarations
    ADD CONSTRAINT lead_gwg_declarations_occupation_check CHECK (
        occupation IS NULL OR char_length(occupation) <= 200
    ),
    ADD CONSTRAINT lead_gwg_declarations_sector_check CHECK (
        sector IS NULL OR char_length(sector) <= 200
    );

-- 2. The third-party payer's messenger / WhatsApp number.
ALTER TABLE lead_payer_declarations
    ADD COLUMN IF NOT EXISTS messenger TEXT;

ALTER TABLE lead_payer_declarations
    DROP CONSTRAINT IF EXISTS lead_payer_declarations_messenger_check;
ALTER TABLE lead_payer_declarations
    ADD CONSTRAINT lead_payer_declarations_messenger_check CHECK (
        messenger IS NULL OR (payer_kind = 'third_party' AND char_length(messenger) <= 60)
    );

-- 3. Siblings and grandparents. The check of the declaration is named by
-- migration 20261005180000; the one of the payer's statement is a column
-- check of migration 20261006110000 (its name is generated), so every
-- single-column check on that column is dropped and added again.
ALTER TABLE lead_payer_declarations
    DROP CONSTRAINT IF EXISTS lead_payer_declarations_relationship_kind_check;
ALTER TABLE lead_payer_declarations
    ADD CONSTRAINT lead_payer_declarations_relationship_kind_check CHECK (
        relationship_kind IS NULL
        OR (payer_kind = 'third_party'
            AND relationship_kind IN (
                'spouse', 'parent', 'child', 'sibling', 'grandparent', 'relative',
                'employer', 'friend', 'business_partner', 'other'))
    );

DO $$
DECLARE
    kind_check RECORD;
BEGIN
    FOR kind_check IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'c'
          AND c.conrelid = 'lead_payer_statements'::regclass
          AND a.attname = 'relationship_kind'
          AND array_length(c.conkey, 1) = 1
    LOOP
        EXECUTE format('ALTER TABLE lead_payer_statements DROP CONSTRAINT IF EXISTS %I',
                       kind_check.conname);
    END LOOP;
END $$;

ALTER TABLE lead_payer_statements
    DROP CONSTRAINT IF EXISTS lead_payer_statements_relationship_kind_check;
ALTER TABLE lead_payer_statements
    ADD CONSTRAINT lead_payer_statements_relationship_kind_check CHECK (
        relationship_kind IS NULL
        OR relationship_kind IN (
            'spouse', 'parent', 'child', 'sibling', 'grandparent', 'relative',
            'employer', 'friend', 'business_partner', 'other')
    );
