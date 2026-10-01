-- The cardiology and oncology templates were seeded by the codes of the
-- original directory rows. Environments also hold specializations created in
-- the directory under the same names with other codes (for example
-- 'kardiologie'); those are the ones in use and got only the general
-- questions. Give every Kardiologie / Onkologie entry the template the clinic
-- wrote, unless staff already changed its text.
WITH general AS (
    SELECT concat_ws(E'\n',
        'Aktuelle Beschwerden im Fachgebiet (ja/nein + if ja: Note)',
        'Voruntersuchungen im Fachgebiet (ja/nein + if ja: Note)',
        'Vorbehandlungen im Fachgebiet (ja/nein + if ja: Note)',
        'Operationen im Fachgebiet (ja/nein + if ja: Note)',
        'Medikamente im Fachgebiet (ja/nein + if ja: Note)',
        'Familiäre Belastung im Fachgebiet (ja/nein + if ja: Note)'
    ) AS template
)
UPDATE medical_specializations ms
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
FROM general
WHERE ms.deleted_at IS NULL
  AND (lower(btrim(ms.name_de)) = 'kardiologie' OR ms.code IN ('cardiology', 'kardiologie'))
  AND (ms.anamnesis_template IS NULL OR ms.anamnesis_template = general.template);

-- Oncology as the clinic fills it in: B symptoms as a group, then the family
-- history. Replaces the first, plain-text seed and the general questions.
WITH general AS (
    SELECT concat_ws(E'\n',
        'Aktuelle Beschwerden im Fachgebiet (ja/nein + if ja: Note)',
        'Voruntersuchungen im Fachgebiet (ja/nein + if ja: Note)',
        'Vorbehandlungen im Fachgebiet (ja/nein + if ja: Note)',
        'Operationen im Fachgebiet (ja/nein + if ja: Note)',
        'Medikamente im Fachgebiet (ja/nein + if ja: Note)',
        'Familiäre Belastung im Fachgebiet (ja/nein + if ja: Note)'
    ) AS template
)
UPDATE medical_specializations ms
SET anamnesis_template = concat_ws(E'\n',
        'B-Symptomatik (ja/nein)',
        '- Fieber (ja/nein + if ja: Note)',
        '- Gewichtsverlust (ja/nein + if ja: Note)',
        '- Nachtschweiß (ja/nein + if ja: Note)',
        'Positive Familienanamnese (ja/nein + if ja: Note)'
    ),
    updated_at = now()
FROM general
WHERE ms.deleted_at IS NULL
  AND (lower(btrim(ms.name_de)) = 'onkologie' OR ms.code IN ('oncology', 'onkologie'))
  AND (
      ms.anamnesis_template IS NULL
      OR ms.anamnesis_template = general.template
      OR ms.anamnesis_template = E'B-Symptomatik:\n- Fieber:\n- Gewichtsverlust:\n- Nachtschweiß:'
  );
