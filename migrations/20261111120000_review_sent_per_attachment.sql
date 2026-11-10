-- A signature package may carry two informational attachments (the
-- Datenschutzinformation and the Vorläufige Kostenkalkulation). The "sent"
-- event was unique per request, so only the first attachment was marked
-- «Отправлен для ознакомления» and the second stayed «Не отправлен» with the
-- manual button (DEV, 2026-11-10). It is unique per request and document now.
DROP INDEX IF EXISTS document_review_sent_once;
CREATE UNIQUE INDEX document_review_sent_once
    ON document_review_events(signature_request_id, document_id)
    WHERE kind = 'sent' AND signature_request_id IS NOT NULL;

-- Attachments that went out with a package and got no event of their own.
INSERT INTO document_review_events
    (id, document_id, kind, actor_id, signature_request_id, test_mode, created_at)
SELECT gen_random_uuid(), attachment.document_id, 'sent', request.requested_by,
       request.id, request.test_mode, attachment.created_at
FROM document_signature_attachments attachment
JOIN document_signature_requests request ON request.id = attachment.request_id
WHERE attachment.stage = 'sent'
  AND NOT EXISTS (
      SELECT 1 FROM document_review_events event
      WHERE event.document_id = attachment.document_id
        AND event.kind = 'sent'
        AND event.signature_request_id = request.id)
ON CONFLICT DO NOTHING;
