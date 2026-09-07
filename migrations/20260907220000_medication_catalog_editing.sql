-- Stable identities and optimistic concurrency for the editable name dictionary.
ALTER TABLE medication_name_pairs
    ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0);

CREATE UNIQUE INDEX medication_name_pairs_by_id ON medication_name_pairs (id);
