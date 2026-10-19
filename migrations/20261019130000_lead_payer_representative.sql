-- A minor's parent or legal representative who pays (owner decision
-- 2026-10-19): the parent who signs the contract is the contracting party
-- (Auftraggeber, "im eigenen Namen zugunsten des Patienten", § 328 BGB) and
-- is never recorded as a third-party payer (no Kostenübernehmer, no
-- Schuldbeitritt, no Kostenübernahmeerklärung).
--
-- `payer_kind = 'representative'` names the paying representative by the id
-- of the lead's trusted contact (`payer_representative_id`, the contact id of
-- `lead_representatives`). The payer's identity is not stored on the
-- declaration for this kind: name, date of birth, address and citizenships
-- are read from the representative whenever they are needed.
--
-- Existing third-party rows that name a parent stay as they are; the server
-- recognises such a parent by e-mail or by name and date of birth and treats
-- the row like the new kind (no data migration).

ALTER TABLE lead_payer_declarations
    ADD COLUMN IF NOT EXISTS payer_representative_id UUID;

-- The kind check was added inline with the column (migration 20261004100000),
-- so PostgreSQL named it `lead_payer_declarations_payer_kind_check`; a
-- rehearsal on a copy whose check carries another name is covered by dropping
-- every single-column check on the column.
DO $$
DECLARE
    kind_check RECORD;
BEGIN
    FOR kind_check IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'c'
          AND c.conrelid = 'lead_payer_declarations'::regclass
          AND a.attname = 'payer_kind'
          AND array_length(c.conkey, 1) = 1
    LOOP
        EXECUTE format('ALTER TABLE lead_payer_declarations DROP CONSTRAINT IF EXISTS %I',
                       kind_check.conname);
    END LOOP;
END $$;

ALTER TABLE lead_payer_declarations
    DROP CONSTRAINT IF EXISTS lead_payer_declarations_payer_kind_check,
    DROP CONSTRAINT IF EXISTS lead_payer_declarations_representative_check,
    DROP CONSTRAINT IF EXISTS lead_payer_declarations_representative_identity_check;

ALTER TABLE lead_payer_declarations
    ADD CONSTRAINT lead_payer_declarations_payer_kind_check CHECK (
        payer_kind IN ('self', 'third_party', 'representative')
    ),
    -- The representative is named exactly for its kind.
    ADD CONSTRAINT lead_payer_declarations_representative_check CHECK (
        (payer_kind = 'representative') = (payer_representative_id IS NOT NULL)
    ),
    -- No copy of the representative's identity on the declaration.
    ADD CONSTRAINT lead_payer_declarations_representative_identity_check CHECK (
        payer_kind <> 'representative'
        OR (first_name IS NULL AND last_name IS NULL AND date_of_birth IS NULL
            AND place_of_birth IS NULL AND street IS NULL AND zip IS NULL
            AND city IS NULL AND country IS NULL AND email IS NULL AND phone IS NULL
            AND cardinality(citizenships) = 0)
    );
