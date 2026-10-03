-- A person may hold several citizenships (owner decision 2026-10-03). They are
-- stored as ISO 3166-1 alpha-2 codes so that sanctions screening and the AML
-- country risk can compare them. The single free-text `patients.nationality`
-- and the wizard's `registration_country` stay readable until every reader
-- uses these columns; filling them from the old values is a separate step.
ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS citizenships TEXT[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE patients
    ADD COLUMN IF NOT EXISTS citizenships TEXT[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE leads
    DROP CONSTRAINT IF EXISTS leads_citizenships_iso_check,
    ADD CONSTRAINT leads_citizenships_iso_check
        CHECK (array_to_string(citizenships, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$');
ALTER TABLE patients
    DROP CONSTRAINT IF EXISTS patients_citizenships_iso_check,
    ADD CONSTRAINT patients_citizenships_iso_check
        CHECK (array_to_string(citizenships, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$');
