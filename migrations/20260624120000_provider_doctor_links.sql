CREATE TABLE IF NOT EXISTS provider_doctor_links (
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES provider_doctors(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider_id, doctor_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_doctor_links_doctor
    ON provider_doctor_links(doctor_id);

INSERT INTO provider_doctor_links (provider_id, doctor_id)
SELECT provider_id, id
FROM provider_doctors
ON CONFLICT (provider_id, doctor_id) DO NOTHING;

CREATE OR REPLACE FUNCTION provider_doctor_self_link()
RETURNS trigger AS $$
BEGIN
    INSERT INTO provider_doctor_links (provider_id, doctor_id)
    VALUES (NEW.provider_id, NEW.id)
    ON CONFLICT (provider_id, doctor_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_provider_doctor_self_link ON provider_doctors;
CREATE TRIGGER trg_provider_doctor_self_link
AFTER INSERT ON provider_doctors
FOR EACH ROW
EXECUTE FUNCTION provider_doctor_self_link();
