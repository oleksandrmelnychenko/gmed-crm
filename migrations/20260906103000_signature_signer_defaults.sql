-- Organisation-wide agency representatives; client details remain document-specific.
CREATE TABLE signature_signer_defaults (
    singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
    signers JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(signers) = 'array' AND jsonb_array_length(signers) <= 5),
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
