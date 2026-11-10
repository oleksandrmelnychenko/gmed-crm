-- A minor's parent who neither pays nor receives the invoices adds no risk
-- trigger (owner 2026-11-02). When that parent's citizenship or residence is
-- on a country list, the wizard shows it, and the CEO or Sales confirms they
-- are aware (owner decision 2026-11-10). One row per confirmation; a change
-- of the countries asks again (the stored countries no longer match).
CREATE TABLE IF NOT EXISTS lead_uncounted_parent_acknowledgements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    representative_id UUID NOT NULL,
    -- The listed countries (ISO codes, sorted) the confirmation covers.
    countries TEXT[] NOT NULL,
    acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_uncounted_parent_acknowledgements_lead_idx
    ON lead_uncounted_parent_acknowledgements (lead_id, representative_id, acknowledged_at DESC);
