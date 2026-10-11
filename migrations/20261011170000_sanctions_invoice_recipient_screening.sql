-- Sanctions screening of the invoice recipient (owner decision 2026-10-11): a
-- third party — a person or an organisation — the lead names in step 3 of the
-- cabinet (`lead_invoice_recipients`, migration 20261011160000) is screened
-- against the EU consolidated list as subject `lead_recipient`
-- (`subject_ref` 'invoice-recipient') while it does not pay. A recipient who
-- pays is the third-party payer and screened as `lead_payer`.
-- See docs/architecture/sanctions-screening_ua.md.

-- The subject kind check (last set by migration 20261011143000 as
-- `sanctions_hits_subject_kind_check`); a copy whose check carries another
-- name is covered by dropping every single-column check on the column.
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
        subject_kind IN (
            'lead_patient', 'lead_guardian', 'lead_payer', 'lead_bank', 'lead_recipient', 'patient'
        )
    );

-- One recipient per lead.
ALTER TABLE sanctions_hits
    DROP CONSTRAINT IF EXISTS sanctions_hits_recipient_ref_check;
ALTER TABLE sanctions_hits
    ADD CONSTRAINT sanctions_hits_recipient_ref_check CHECK (
        subject_kind <> 'lead_recipient' OR subject_ref = 'invoice-recipient'
    );

-- Re-screen the lead whenever its recipient answers change (any writer). The
-- function of migration 20261004110000 queues the row's `lead_id`; a new list
-- version re-screens every open lead anyway.
DROP TRIGGER IF EXISTS trg_sanctions_enqueue_lead_of_invoice_recipient
    ON lead_invoice_recipients;
CREATE TRIGGER trg_sanctions_enqueue_lead_of_invoice_recipient
    AFTER INSERT OR UPDATE OR DELETE ON lead_invoice_recipients
    FOR EACH ROW EXECUTE FUNCTION sanctions_enqueue_lead_of_payer();
