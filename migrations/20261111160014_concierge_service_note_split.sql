-- Release QA S2-1, owner decision 2026-11-11 («Так, розділити»): the one
-- «Заметки по сервису» field of a concierge service was shown to the patient
-- on the portal and also held the patient's own note of a portal request,
-- which staff then overwrote. It is split into three notes:
--
--   service_notes         internal staff note; never sent to the patient
--                         (the existing column keeps this meaning)
--   patient_request_note  the patient's own text of a portal request; staff
--                         read it and never change it
--   patient_visible_note  the note staff write for the patient on purpose;
--                         the only staff text the portal shows
--
-- Existing rows cannot be told apart reliably: a portal request's note may
-- since have been edited by staff, and the patient's original text is stored
-- nowhere else (the create audit event and the staff notification carry no
-- note; the task description is a copy taken later). So every existing text
-- stays where it is, in the internal note: nothing that was hidden becomes
-- visible, and the patient no longer sees earlier staff text. Both new
-- columns start empty. No data is changed or deleted.

ALTER TABLE concierge_services
    ADD COLUMN patient_request_note TEXT,
    ADD COLUMN patient_visible_note TEXT;

COMMENT ON COLUMN concierge_services.service_notes IS
    'Internal staff note of the service; never sent to the patient portal.';
COMMENT ON COLUMN concierge_services.patient_request_note IS
    'The patient''s own note from a portal service request; read-only for staff.';
COMMENT ON COLUMN concierge_services.patient_visible_note IS
    'Note staff write for the patient; the only staff text the patient portal shows.';
