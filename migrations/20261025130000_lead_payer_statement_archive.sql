-- The sent questionnaire of a previous payer (QA 2026-10-25, lead map item
-- 95). `lead_payer_statements` holds one row per lead: when the payer changes
-- — another person, or the same payer at another e-mail address, whose holder
-- may be somebody else — the row is cleared for the new payer, and what the
-- previous payer had sent was gone; only its archived identity document
-- ("Früherer Zahler – …") stayed in the documents list. Staff must still see
-- that statement: the sent row is copied here in the transaction of the
-- reset, before the clear. The wizard lists the copies newest first; the
-- current statement is never one of them.
--
-- Kept like the statement itself: with the lead (ON DELETE CASCADE), deleted
-- by the purge of an unconverted lead, kept for a converted one (§ 8 Abs. 4
-- GwG). `statement` is the statement as staff read it (the API keys of the
-- answers, the confirmed address, the privacy acknowledgement and the times)
-- — never a token, code or session secret.
CREATE TABLE lead_payer_statement_archive (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    -- `link`: the payer's own link; `cabinet`: a paying parent in the cabinet.
    source TEXT NOT NULL CHECK (source IN ('link', 'cabinet')),
    -- `payer_kind` of the declaration the statement belonged to (third_party,
    -- representative), and the payer type (person, company, organisation,
    -- insurance).
    payer_kind TEXT NOT NULL CHECK (char_length(payer_kind) <= 40),
    payer_type TEXT NOT NULL CHECK (char_length(payer_type) <= 40),
    -- The organisation, or first and last name, as stated.
    payer_name TEXT CHECK (payer_name IS NULL OR char_length(payer_name) <= 300),
    submitted_at TIMESTAMPTZ NOT NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_reason TEXT NOT NULL CHECK (archived_reason IN ('payer_changed', 'email_changed')),
    archived_by UUID REFERENCES users(id) ON DELETE SET NULL,
    -- The archived copy of the payer's identity document, if one was uploaded.
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    statement JSONB NOT NULL
);

CREATE INDEX lead_payer_statement_archive_lead_idx
    ON lead_payer_statement_archive (lead_id, archived_at DESC);
