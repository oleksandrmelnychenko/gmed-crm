-- The request register only knew erasure, restriction and third-party revoke.
-- Access (Art. 15), rectification (Art. 16), portability (Art. 20) and
-- objection (Art. 21) requests must be recorded and answered within the same
-- one-month deadline, so they join the same queue.
ALTER TABLE patient_privacy_requests
    DROP CONSTRAINT IF EXISTS patient_privacy_requests_request_type_check;

ALTER TABLE patient_privacy_requests
    ADD CONSTRAINT patient_privacy_requests_request_type_check
        CHECK (request_type IN (
            'erasure', 'restriction', 'third_party_revoke',
            'access', 'rectification', 'portability', 'objection'
        ));
