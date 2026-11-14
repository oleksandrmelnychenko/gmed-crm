-- The patient's treatment plan («Behandlungsplan») never names the doctor or
-- the clinic (owner 2026-11-14). Staff may give each visit its own line for
-- the patient (e.g. «Предоперационное обследование кардиолога (ЭКГ)») and a
-- preparation note printed under the day (e.g. «Пожалуйста, не завтракайте!»).
-- Both are optional; without the line the plan names the specialization.
ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS patient_plan_text TEXT,
    ADD COLUMN IF NOT EXISTS patient_preparation_note TEXT;
