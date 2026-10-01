-- A specialization's anamnesis template may consist of yes/no questions with
-- follow-up fields. The answers are kept beside the readable text composed
-- from them (narrative_text), together with the template they were given
-- against, so a version can be edited again without parsing its text.
ALTER TABLE patient_narrative_specializations
    ADD COLUMN IF NOT EXISTS checklist JSONB;

ALTER TABLE patient_narrative_specializations
    DROP CONSTRAINT IF EXISTS patient_narrative_specializations_checklist_object;

ALTER TABLE patient_narrative_specializations
    ADD CONSTRAINT patient_narrative_specializations_checklist_object
        CHECK (checklist IS NULL OR jsonb_typeof(checklist) = 'object');

-- Cardiology starts with the cardiovascular risk factors (owner decision
-- 2026-10-01). A bracket such as "(ja/nein + if ja: Note)" makes the line a
-- yes/no question; the directory keeps the text editable.
UPDATE medical_specializations
SET anamnesis_template = concat_ws(E'\n',
        'CVRF (ja/nein)',
        '- art. Hypertonie (ja/nein)',
        '- Diabetes mellitus (ja/nein)',
        '- Nikotin (ja/nein + if ja: Pack Years (Number))',
        '- Dyslipoproteinämie (ja/nein + if ja: Note)',
        '- Übergewicht (ja/nein + if ja: Gewicht in kg + Größe in cm + BMI)',
        '- Ungesunde Ernährung (ja/nein + if ja: Note)',
        '- Positive Eigenanamnese (ja/nein + if ja: Herzinfarkt/Schlaganfall/pAVK/Thrombosen + Note)',
        '- Lp(a)-high (ja/nein + if ja: Note)',
        '- Positive Familienanamnese (ja/nein + if ja: Herzinfarkt/Schlaganfall/pAVK/Thrombosen + Note)'
    ),
    updated_at = now()
WHERE code = 'cardiology'
  AND anamnesis_template IS NULL;
