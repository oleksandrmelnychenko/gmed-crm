-- A representative may type the data of the own identity document in the
-- cabinet, next to the copy (owner 2026-11-10, as the lead since the same
-- day). The mark says the data came from the cabinet, so the wizard asks
-- staff to compare them with the scan until staff save the data themselves
-- (`id_data_entered_at`).
ALTER TABLE lead_representatives
    ADD COLUMN IF NOT EXISTS id_data_client_at TIMESTAMPTZ;
