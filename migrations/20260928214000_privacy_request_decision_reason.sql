-- Art. 12 Abs. 4 DSGVO: when the controller does not act on a data subject
-- request, the data subject is told why. Rejecting a request (and revising an
-- already approved one) now requires a reason; it is kept apart from the
-- internal review note because the patient portal shows it.
ALTER TABLE patient_privacy_requests
    ADD COLUMN IF NOT EXISTS decision_reason TEXT;

COMMENT ON COLUMN patient_privacy_requests.decision_reason IS
    'Reason for rejecting or holding the request, told to the data subject (Art. 12 Abs. 4 DSGVO) and shown in the patient portal. review_note stays internal.';
