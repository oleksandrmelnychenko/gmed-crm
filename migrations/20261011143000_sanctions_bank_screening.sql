-- Sanctions screening of the bank of the payment route (owner decision
-- 2026-10-11, after the compliance consultant's note that the EU list and
-- FiSaLis name organisations, banks included). The bank the patient, a paying
-- parent or the third-party payer (through its own link) names in section 8
-- of the payer declaration is screened against the listed entities as subject
-- `lead_bank` (`subject_ref` 'patient-bank' or 'payer-bank').
-- See docs/architecture/sanctions-screening_ua.md.

-- The subject kind check was added inline with the column (migration
-- 20261004110000), so PostgreSQL named it `sanctions_hits_subject_kind_check`;
-- a copy whose check carries another name is covered by dropping every
-- single-column check on the column.
DO $$
DECLARE
    kind_check RECORD;
BEGIN
    FOR kind_check IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'c'
          AND c.conrelid = 'sanctions_hits'::regclass
          AND a.attname = 'subject_kind'
          AND array_length(c.conkey, 1) = 1
    LOOP
        EXECUTE format('ALTER TABLE sanctions_hits DROP CONSTRAINT IF EXISTS %I', kind_check.conname);
    END LOOP;
END $$;

ALTER TABLE sanctions_hits
    ADD CONSTRAINT sanctions_hits_subject_kind_check CHECK (
        subject_kind IN ('lead_patient', 'lead_guardian', 'lead_payer', 'lead_bank', 'patient')
    );

-- A bank hit names whose payment route it is.
ALTER TABLE sanctions_hits
    DROP CONSTRAINT IF EXISTS sanctions_hits_bank_ref_check;
ALTER TABLE sanctions_hits
    ADD CONSTRAINT sanctions_hits_bank_ref_check CHECK (
        subject_kind <> 'lead_bank' OR subject_ref IN ('patient-bank', 'payer-bank')
    );

-- Re-screen when the bank or its country changes. Section 8 lives on
-- lead_payer_declarations; trg_sanctions_enqueue_lead_of_payer (migration
-- 20261004110000) fires on every change of a row, whoever writes it (the
-- cabinet, the payer's link, staff). It is attached again here so the bank's
-- re-screening does not depend on the order in which the payer declaration
-- migrations ran.
DO $$
BEGIN
    IF to_regclass('public.lead_payer_declarations') IS NOT NULL THEN
        EXECUTE 'DROP TRIGGER IF EXISTS trg_sanctions_enqueue_lead_of_payer ON lead_payer_declarations';
        EXECUTE 'CREATE TRIGGER trg_sanctions_enqueue_lead_of_payer
                 AFTER INSERT OR UPDATE OR DELETE ON lead_payer_declarations
                 FOR EACH ROW EXECUTE FUNCTION sanctions_enqueue_lead_of_payer()';
    END IF;
END;
$$;
