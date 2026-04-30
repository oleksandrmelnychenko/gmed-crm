CREATE INDEX IF NOT EXISTS idx_accounting_entries_patient_date
    ON accounting_entries(patient_id, entry_date DESC, created_at DESC)
    WHERE patient_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounting_entries_patient_category
    ON accounting_entries(patient_id, category, entry_date DESC)
    WHERE patient_id IS NOT NULL;
