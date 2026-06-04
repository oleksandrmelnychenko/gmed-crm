-- Patient-level clinical master record (independent of case episodes).
-- v1 scope: diagnoses (ICD + main/secondary), medications (German Medikationsplan / BMP),
-- and examinations (Befunde). Each entry is attributed to the provider + doctor who
-- issued it (prescribed / diagnosed / examined). Recommendations already exist
-- (patient_recommendations) and are surfaced read-only rather than duplicated here.
--
-- provider_id / doctor_id use ON DELETE SET NULL so a removed provider or doctor never
-- cascades away a patient's clinical history.

CREATE TABLE patient_diagnoses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
    doctor_id UUID REFERENCES provider_doctors(id) ON DELETE SET NULL,
    kind TEXT NOT NULL DEFAULT 'secondary' CHECK (kind IN ('main', 'secondary')),
    label TEXT NOT NULL,
    icd_code TEXT,
    grade TEXT,
    laterality TEXT CHECK (laterality IS NULL OR laterality IN ('left', 'right', 'bilateral')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'chronic', 'resolved')),
    diagnosed_on TEXT,
    note TEXT,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_patient_diagnoses_patient ON patient_diagnoses (patient_id);

-- Medikationsplan rows. `category` mirrors the three BMP sections:
--   'dauer'     -> Dauermedikation (regular plan)
--   'besondere' -> Zu besonderen Zeiten anzuwendende Medikamente (PRN / special times)
--   'selbst'    -> Selbstmedikation (self-medication)
-- Dosing is the BMP four-slot schedule (Morgens / Mittags / Abends / zur Nacht),
-- each kept as free text so "½", "1", "20" etc. are all representable.
CREATE TABLE patient_medications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
    doctor_id UUID REFERENCES provider_doctors(id) ON DELETE SET NULL,
    category TEXT NOT NULL DEFAULT 'dauer' CHECK (category IN ('dauer', 'besondere', 'selbst')),
    wirkstoff TEXT,
    handelsname TEXT NOT NULL,
    staerke TEXT,
    form TEXT,
    dose_morgens TEXT,
    dose_mittags TEXT,
    dose_abends TEXT,
    dose_nachts TEXT,
    einheit TEXT,
    hinweis TEXT,
    grund TEXT,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_patient_medications_patient ON patient_medications (patient_id);

-- Examinations / Befunde. `kind` is the modality (Sonografie, Labor, Histologie, EKG,
-- Mikrobiologie, Röntgen, körperliche Untersuchung, …). `status` distinguishes a final
-- result from one still pending ("Befund ausstehend").
CREATE TABLE patient_examinations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
    doctor_id UUID REFERENCES provider_doctors(id) ON DELETE SET NULL,
    kind TEXT CHECK (
        kind IS NULL
        OR kind IN ('sonography', 'lab', 'histology', 'ecg', 'microbiology', 'radiology', 'exam', 'other')
    ),
    title TEXT NOT NULL,
    performed_on TEXT,
    status TEXT NOT NULL DEFAULT 'final' CHECK (status IN ('final', 'pending')),
    result TEXT,
    note TEXT,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_patient_examinations_patient ON patient_examinations (patient_id);
