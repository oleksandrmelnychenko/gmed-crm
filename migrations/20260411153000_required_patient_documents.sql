INSERT INTO system_settings (key, value, description) VALUES
(
    'required_patient_documents',
    '[
      {
        "key": "passport",
        "label": "Reisepass",
        "art": ["passport", "passport_scan", "reisepass"],
        "category": ["identity", "passport"]
      },
      {
        "key": "consent_form",
        "label": "Einverständniserklärung",
        "art": ["consent", "consent_form", "einverstaendniserklaerung"],
        "category": ["consent", "administrative"]
      }
    ]'::jsonb,
    'Minimum patient document pack used for missing-document alerts'
)
ON CONFLICT (key) DO NOTHING;
