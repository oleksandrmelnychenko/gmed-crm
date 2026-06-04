-- Patient-level clinical narrative (the free-text Arztbrief blocks), one row per
-- patient. Complements the structured v1 sections (diagnoses / medications /
-- examinations) with Anamnese (split into its standard sub-sections),
-- Untersuchungsbefund, Beurteilung and Verlauf.

CREATE TABLE patient_clinical_narrative (
    patient_id UUID PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
    anamnese_aktuelle TEXT,
    anamnese_vorgeschichte TEXT,
    anamnese_vegetative TEXT,
    anamnese_sozial TEXT,
    untersuchungsbefund TEXT,
    beurteilung TEXT,
    verlauf TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
