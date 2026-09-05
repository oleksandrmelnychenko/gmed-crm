-- Preparation only: this table contains no credentials or granted permissions.
CREATE TABLE datev_integration_setup (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    revision UUID NOT NULL,
    profile JSONB NOT NULL CHECK (jsonb_typeof(profile) = 'object'),
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
