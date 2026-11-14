-- The planning grid's draft keeps the patient-facing texts of a visit (owner
-- 2026-11-14, with fix 63): «Текст для пациента» (its line in the patient's
-- plan) and «Примечание» (printed under the day heading), carried into the
-- visit when «Создать все приёмы» creates it.
ALTER TABLE order_visit_drafts
    ADD COLUMN IF NOT EXISTS patient_plan_text TEXT,
    ADD COLUMN IF NOT EXISTS patient_preparation_note TEXT;
