-- Codes the CEO issued by hand for a payer's link when the code e-mail
-- cannot reach the payer (owner decision 2026-11-16). One row per issue:
-- who, when and until when — never the code itself (its hash replaces the
-- link's current code in `lead_payer_links`). The rows go with the link, so
-- the purge of an unconverted lead removes them too. The audit row
-- `payer_link_manual_code_issued` is written in the same transaction.
CREATE TABLE lead_payer_link_manual_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    link_id UUID NOT NULL REFERENCES lead_payer_links(id) ON DELETE CASCADE,
    issued_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    CHECK (expires_at > created_at)
);

CREATE INDEX lead_payer_link_manual_codes_link_idx
    ON lead_payer_link_manual_codes (link_id, created_at DESC);
