-- Phase 3 — Aktuelle Medikation: richer per-medication fields for the
-- patient_medications master table. Adds route of administration, prescription /
-- intake dates, a lifecycle status, regulatory flags (Apotheken-/Rezeptpflicht,
-- BtM, Aut-idem-Sperre, Abgabebeschränkung) and a free-text "Sonstige Vermerke".
--
-- The existing `form` column is reused as Darreichungsform (now a required dropdown
-- in the UI); `einnahmeform` is the new route-of-administration field.

ALTER TABLE patient_medications
    ADD COLUMN einnahmeform TEXT,
    ADD COLUMN verordnet_am TEXT,
    ADD COLUMN einnahme_von TEXT,
    ADD COLUMN einnahme_bis TEXT,
    ADD COLUMN status TEXT NOT NULL DEFAULT 'aktiv',
    ADD COLUMN apothekenpflichtig BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN rezeptpflichtig BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN btm BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN aut_idem_sperre BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN abgabebeschraenkung BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN sonstige_vermerke TEXT;

ALTER TABLE patient_medications
    ADD CONSTRAINT patient_medications_status_check
    CHECK (status IN ('aktiv', 'pausiert', 'abgesetzt', 'geplant'));
