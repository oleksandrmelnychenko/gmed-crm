-- Identification by qualified electronic signature (§ 12 Abs. 1 GwG, owner
-- decision 2026-10-05). A completed QES of the person counts as the
-- identification; the law adds a payment that arrives directly from a payment
-- account in that person's own name. Staff confirm that payment by hand: one
-- mark per person with who and when. Nothing is blocked by the mark; the lead
-- wizard and the identification sheet only show it.
-- See docs/architecture/gwg-identification-sheet_ua.md.

-- A row = staff confirmed the own-account payment of that person of the lead:
-- the patient (`contract_partner`) or the third-party payer (`payer`).
-- Revoking the confirmation deletes the row; the audit log keeps the history.
CREATE TABLE IF NOT EXISTS lead_identification_payments (
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    subject TEXT NOT NULL CHECK (subject IN ('contract_partner', 'payer')),
    confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    note TEXT CHECK (note IS NULL OR char_length(note) <= 500),
    PRIMARY KEY (lead_id, subject)
);
