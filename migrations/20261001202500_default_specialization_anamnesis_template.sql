-- Every specialization starts with a real anamnesis template instead of an
-- empty field (owner decision 2026-10-01). The general questions below apply
-- to any specialty; the directory keeps each template editable, and the
-- templates already written for a specialization are left as they are.
UPDATE medical_specializations
SET anamnesis_template = concat_ws(E'\n',
        'Aktuelle Beschwerden im Fachgebiet (ja/nein + if ja: Note)',
        'Voruntersuchungen im Fachgebiet (ja/nein + if ja: Note)',
        'Vorbehandlungen im Fachgebiet (ja/nein + if ja: Note)',
        'Operationen im Fachgebiet (ja/nein + if ja: Note)',
        'Medikamente im Fachgebiet (ja/nein + if ja: Note)',
        'Familiäre Belastung im Fachgebiet (ja/nein + if ja: Note)'
    ),
    updated_at = now()
WHERE anamnesis_template IS NULL
  AND deleted_at IS NULL;
